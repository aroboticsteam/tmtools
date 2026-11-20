# Encrypted recording SSD runbook (tmtools-server)

Script: `media-ssd.sh` (copy to the Pi, e.g. `/root/media-ssd.sh`, `chmod +x`). Run as root. Add `--dry-run` to any subcommand to print commands only.
Prereqs on the Pi (already installed 2026-11-20): `cryptsetup 2.7.5`, `parted`, `smartmontools`. dm_crypt loads, aes-xts uses ARM CE (`xts-aes-ce`), ~1.4 GiB/s, so encryption is not a bottleneck for 15 Mbps recordings.

## Setup (once, SSD plugged in)

1. `sudo ./media-ssd.sh inspect`  - find the SSD. It must show `candidate`; the SD card is `REFUSED: boot disk`. Note the `by-id:` path.
2. `smartctl -a /dev/sdX` (optional health check).
3. `sudo ./media-ssd.sh --dry-run format /dev/disk/by-id/<id>` - review the commands.
4. `sudo ./media-ssd.sh format /dev/disk/by-id/<id>` - type the serial to confirm. It creates GPT + 1 partition, LUKS2, `/etc/tmtools/media.key` (0400, only if absent), optional operator passphrase slot (answer `y` and type it when cryptsetup asks; this is your recovery path if the SD card dies), header backup, ext4 label `tmtools-media`, mounts at `/mnt/media`, creates `/mnt/media/garage`.
5. **Copy `/root/media-luks-header.img` and `/etc/tmtools/media.key` off the Pi** (scp to laptop / password manager). If the header is damaged and there is no backup, data is unrecoverable. Restore: `cryptsetup luksHeaderRestore <partition> --header-backup-file media-luks-header.img`.
6. `sudo ./media-ssd.sh install-boot` - writes UUID-based `/etc/crypttab` and `/etc/fstab` entries with `nofail,x-systemd.device-timeout=10`. A missing SSD never blocks boot. Reboot-test when convenient: `findmnt /mnt/media; systemctl --failed`.

Other: `unlock`, `lock` (umount + close), `status`.

## Security tradeoff (read this)

The keyfile lives on the SD card so the Pi auto-unlocks at boot with nobody present.
- SSD stolen alone: only ciphertext, safe.
- Pi + SSD stolen together: the key is on the SD card, encryption is defeated.
- SD card dies: use the passphrase slot (if you added one) or the key copy you saved off-Pi.
If you want protection against whole-Pi theft, skip `install-boot`, add a passphrase slot, remove the keyfile (`cryptsetup luksRemoveKey`) and run `unlock` by hand after each boot (and garage will not start unattended).

The script sets the immutable bit on the empty `/mnt/media` directory (best effort) so nothing writes to the SD card if the SSD is not mounted. To remove it: `chattr -i /mnt/media` (while unmounted).

## Migrating Garage onto the SSD (not executed; stack untouched in testing)

Current state (read-only inspection): container `tmtools-stack-garage-1` (`dxflrs/garage:v1.1.0`, no explicit user) uses named volumes `tmtools-stack_garage_data` -> `/var/lib/garage/data` (24 MB now) and `tmtools-stack_garage_meta` -> `/var/lib/garage/meta` (4.6 MB). Defined in `/var/lib/tmtools/stack/core.yml` (service `garage`, volumes `garage_meta`, `garage_data`, top-level `volumes:` at the bottom). Garage reports ~15.7 GB data available (the SD card).

Sizing: ~27 GB estimated for ~160 matches at 15 Mbps exceeds the ~15 GB free on the SD card, which is why the data dir must move. Move only `garage_data`; keep `garage_meta` (the LMDB/sqlite DB) on the SD card, or on the SSD too if you accept that without the SSD garage will not start (recommended: data only on SSD, meta stays on SD for speed and so garage still boots when the SSD is absent; objects are then unreadable until it returns).

Procedure (from `/var/lib/tmtools/stack`; verify the compose invocation used on the Pi, typically `docker compose -p tmtools-stack -f core.yml -f auth.yml -f edge.yml -f extras.yml ...`):

1. Confirm `findmnt /mnt/media` shows the mapper device.
2. Stop writers, then garage: stop the capture agent / anything uploading, then `docker compose ... stop garage`.
3. Copy: `rsync -aHAX --info=progress2 /var/lib/docker/volumes/tmtools-stack_garage_data/_data/ /mnt/media/garage/`
4. Edit `core.yml`, service `garage`, volumes:
   ```yaml
       volumes:
         - secrets:/secrets:ro
         - garage_meta:/var/lib/garage/meta
         - /mnt/media/garage:/var/lib/garage/data     # was: garage_data:/var/lib/garage/data
   ```
   and remove `garage_data:` from the top-level `volumes:` (or leave it; unused). Keep a backup: `cp core.yml core.yml.bak-ssd-<date>`.
   Optional guard so docker does not create the dir on the SD card if the SSD is missing: use long syntax `- type: bind, source: /mnt/media/garage, target: /var/lib/garage/data, bind: {create_host_path: false}`. (The `chattr +i` on the mountpoint also protects against this.)
5. `docker compose ... up -d garage` (garage-init will re-run its idempotent init).
6. Verify: `docker exec tmtools-stack-garage-1 /garage status` (DataAvail should now show the SSD size), `docker exec tmtools-stack-garage-1 /garage bucket list` (bucket `tmtools` present), and an S3 listing/object GET through the normal endpoint. Check `df -h /mnt/media` grows with new uploads.
7. After a few days of confirmed good operation, `docker volume rm tmtools-stack_garage_data` to reclaim SD space.

Rollback: stop garage, restore `core.yml.bak-ssd-*`, `up -d garage` (old volume still intact until step 7).

## Testing done

All of the above flow was exercised on a 256 MB loopback image with a throwaway keyfile (`MEDIA_SSD_TEST_LOOP=<img>`), no real disk touched. `looptest.sh` in this folder is the test driver.
