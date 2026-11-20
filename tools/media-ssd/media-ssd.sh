#!/usr/bin/env bash
# media-ssd.sh - LUKS2-encrypted recording SSD helper for the tmtools Pi.
#
#   media-ssd.sh [--dry-run] inspect
#   media-ssd.sh [--dry-run] format <by-id-path>
#   media-ssd.sh [--dry-run] unlock | lock | status | install-boot
#
# Run as root (sudo). See RUNBOOK.md.
#
# Test mode: MEDIA_SSD_TEST_LOOP=/path/to/sparse.img makes the script attach
# that file with losetup and treat the loop device as the disk, running the SAME
# code path (the /dev/disk/by-id and removable checks are replaced by "is a
# regular file"; boot-disk, mounted-partition and serial checks still run).
# Test mode never touches anything but the image.
#
# Path overrides (mainly for tests): MEDIA_KEY MEDIA_MNT MEDIA_MAPPER
# MEDIA_HDR_BACKUP MEDIA_CRYPTTAB MEDIA_FSTAB.
set -euo pipefail

KEY="${MEDIA_KEY:-/etc/tmtools/media.key}"
MNT="${MEDIA_MNT:-/mnt/media}"
MAPPER="${MEDIA_MAPPER:-tmtools-media}"
FSLABEL="tmtools-media"
LUKSLABEL="tmtools-media-luks"
HDR_BACKUP="${MEDIA_HDR_BACKUP:-/root/media-luks-header.img}"
CRYPTTAB="${MEDIA_CRYPTTAB:-/etc/crypttab}"
FSTAB="${MEDIA_FSTAB:-/etc/fstab}"
TEST_LOOP="${MEDIA_SSD_TEST_LOOP:-}"
MARK="# tmtools-media"
DRY=0

die()  { echo "ERROR: $*" >&2; exit 1; }
info() { echo "== $*"; }
refuse() { echo "REFUSED: $*" >&2; exit 2; }

# run: execute, or only print under --dry-run
run() {
  if [ "$DRY" = 1 ]; then printf '[dry-run]'; printf ' %q' "$@"; echo; else "$@"; fi
}

need_root() { [ "$(id -u)" = 0 ] || die "run as root (sudo)"; }
need_cmds() { for c in "$@"; do command -v "$c" >/dev/null 2>&1 || die "missing command: $c"; done; }

# ---- helpers ---------------------------------------------------------------
boot_disks() {
  # whole-disk names (e.g. mmcblk0) backing / and /boot/firmware
  local m src
  for m in / /boot /boot/firmware; do
    src=$(findmnt -n -o SOURCE "$m" 2>/dev/null || true)
    if [ -z "$src" ] || [ ! -b "$src" ]; then continue; fi
    lsblk -no PKNAME "$src" 2>/dev/null | head -1
    # source may itself be a disk
    if [ "$(lsblk -dno TYPE "$src")" = disk ]; then basename "$src"; fi
  done | sort -u | sed '/^$/d'
}

disk_serial() {
  local d="$1" s
  s=$(lsblk -dno SERIAL "$d" 2>/dev/null | tr -d ' ' || true)
  if [ -z "$s" ]; then
    s=$(udevadm info --query=property --name="$d" 2>/dev/null | sed -n 's/^ID_SERIAL_SHORT=//p' | head -1)
  fi
  echo "$s"
}

mounted_points() { lsblk -nrpo MOUNTPOINTS "$1" 2>/dev/null | tr ' ' '\n' | sed '/^$/d' | sort -u | tr '\n' ' '; }

# reason string if disk $1 (/dev/xxx) must be refused, else empty
refuse_reason() {
  local d="$1" base mp
  base=$(basename "$d")
  if boot_disks | grep -qx "$base"; then echo "boot disk"; return; fi
  mp=$(mounted_points "$d")
  if [ -n "$mp" ]; then echo "has mounted partitions ($mp)"; return; fi
  echo ""
}

# find LUKS partition: override, test image, or by LUKS label
find_luks_dev() {
  if [ -n "${MEDIA_LUKS_DEV:-}" ]; then echo "$MEDIA_LUKS_DEV"; return; fi
  if [ -n "$TEST_LOOP" ]; then
    local ld; ld=$(attach_loop)
    lsblk -nrpo NAME,TYPE "$ld" | awk '$2=="part"{print $1; exit}'
    return
  fi
  blkid -t "LABEL=$LUKSLABEL" -o device | head -1
}

attach_loop() {
  [ -f "$TEST_LOOP" ] || die "test image $TEST_LOOP missing"
  local ld; ld=$(losetup -j "$TEST_LOOP" | head -1 | cut -d: -f1)
  if [ -z "$ld" ]; then ld=$(losetup -fP --show "$TEST_LOOP"); udevadm settle 2>/dev/null || true; fi
  echo "$ld"
}
detach_loop() {
  [ -n "$TEST_LOOP" ] || return 0
  local ld; ld=$(losetup -j "$TEST_LOOP" | head -1 | cut -d: -f1)
  if [ -n "$ld" ]; then losetup -d "$ld"; fi
}

# ---- inspect ---------------------------------------------------------------
cmd_inspect() {
  need_cmds lsblk
  local boots; boots=$(boot_disks | tr '\n' ' ')
  echo "Boot disk(s): ${boots:-unknown}"
  printf '%-10s %-9s %-22s %-18s %-5s %s\n' DISK SIZE MODEL SERIAL RM STATUS
  lsblk -dnpo NAME,TYPE | awk '$2=="disk"{print $1}' | while read -r d; do
    local b size model serial rm reason status mp
    b=$(basename "$d")
    case "$b" in zram*|ram*|loop*) continue;; esac
    size=$(lsblk -dno SIZE "$d"); model=$(lsblk -dno MODEL "$d" | sed 's/ *$//')
    serial=$(disk_serial "$d"); rm=$(cat "/sys/block/$b/removable" 2>/dev/null || echo "?")
    reason=$(refuse_reason "$d")
    if [ -n "$reason" ]; then status="REFUSED: $reason"; else status="candidate"; fi
    printf '%-10s %-9s %-22s %-18s %-5s %s\n' "$d" "$size" "${model:--}" "${serial:--}" "$rm" "$status"
    for l in /dev/disk/by-id/*; do
      [ -e "$l" ] || continue
      case "$l" in *-part*) continue;; esac
      if [ "$(readlink -f "$l")" = "$d" ]; then echo "           by-id: $l"; fi
    done
    mp=$(mounted_points "$d"); if [ -n "$mp" ]; then echo "           mounted: $mp"; fi
  done
}

# ---- format ----------------------------------------------------------------
cmd_format() {
  local arg="${1:-}" dev serial b reason removable
  [ -n "$arg" ] || die "usage: format <by-id-path>"
  need_cmds lsblk blkid findmnt udevadm
  if [ -n "$TEST_LOOP" ]; then
    [ "$arg" = "$TEST_LOOP" ] || refuse "test mode: argument must equal MEDIA_SSD_TEST_LOOP"
    [ -f "$TEST_LOOP" ] || refuse "$TEST_LOOP is not a regular file"
    dev=$(attach_loop); serial="TESTLOOP"
    trap '[ -e "/dev/mapper/$MAPPER" ] || detach_loop' EXIT
    echo "TEST MODE: using $dev (image $TEST_LOOP)"
  else
    case "$arg" in /dev/disk/by-id/*) ;; *) refuse "$arg is not under /dev/disk/by-id/";; esac
    case "$arg" in *..*) refuse "path traversal in $arg";; esac
    [ -e "$arg" ] || refuse "$arg does not exist"
    dev=$(readlink -f "$arg")
    [ -b "$dev" ] || refuse "$arg does not resolve to a block device"
    [ "$(lsblk -dno TYPE "$dev")" = disk ] || refuse "$arg is not a whole disk (partition link?)"
    b=$(basename "$dev")
    removable=$(cat "/sys/block/$b/removable" 2>/dev/null || echo unknown)
    case "$removable" in 0|1) ;; *) refuse "removable flag unknown for $dev";; esac
    serial=$(disk_serial "$dev")
    [ -n "$serial" ] || refuse "cannot read a serial number for $dev"
  fi
  reason=$(refuse_reason "$dev")
  [ -z "$reason" ] || refuse "$dev: $reason"

  info "Target: $dev  model=$(lsblk -dno MODEL "$dev" | sed 's/ *$//')  size=$(lsblk -dno SIZE "$dev")  serial=$serial"
  echo "Existing signatures (will be destroyed):"
  blkid -p "$dev" 2>/dev/null || true
  lsblk -nrpo NAME,FSTYPE,LABEL "$dev" | sed 's/^/  /'

  if [ "$DRY" = 1 ]; then
    info "dry-run: skipping serial confirmation"
  else
    need_root
    read -r -p "ALL DATA ON $dev WILL BE DESTROYED. Type the disk serial number to confirm: " typed
    [ "$typed" = "$serial" ] || refuse "serial mismatch, nothing changed"
  fi

  info "Keyfile $KEY"
  if [ -e "$KEY" ]; then echo "exists, keeping it"; else
    run install -d -m 0700 "$(dirname "$KEY")"
    if [ "$DRY" = 1 ]; then echo "[dry-run] (umask 077; head -c 64 /dev/urandom > $KEY; chmod 0400 $KEY)"; else
      ( umask 077; head -c 64 /dev/urandom > "$KEY" ); chmod 0400 "$KEY"; chown root:root "$KEY" 2>/dev/null || true
    fi
  fi

  info "Partition table (GPT, one partition)"
  run parted -s "$dev" mklabel gpt mkpart tmtools-media 1MiB 100%
  if [ "$DRY" = 1 ]; then local part="${dev}1"; else
    run partprobe "$dev" 2>/dev/null || true; udevadm settle || true; sleep 1
    local part; part=$(lsblk -nrpo NAME,TYPE "$dev" | awk '$2=="part"{print $1; exit}')
    [ -n "$part" ] || die "partition not found after partitioning"
  fi

  info "LUKS2 format $part"
  # keyfile as the only credential on the command line is fine: it is a path.
  run cryptsetup luksFormat --type luks2 --batch-mode --label "$LUKSLABEL" --key-file "$KEY" "$part"

  if [ "$DRY" = 1 ]; then
    echo "[dry-run] would ask: add an operator passphrase slot? -> cryptsetup luksAddKey --key-file $KEY $part (interactive)"
  else
    read -r -p "Add an operator passphrase slot (typed interactively, as a second way in)? [y/N] " ans || ans=n
    case "$ans" in y|Y) cryptsetup luksAddKey --key-file "$KEY" "$part";; *) echo "skipped";; esac
  fi

  info "LUKS header backup -> $HDR_BACKUP"
  run rm -f "$HDR_BACKUP"
  if [ "$DRY" = 1 ]; then echo "[dry-run] (umask 077; cryptsetup luksHeaderBackup $part --header-backup-file $HDR_BACKUP)"; else
    ( umask 077; cryptsetup luksHeaderBackup "$part" --header-backup-file "$HDR_BACKUP" ); chmod 600 "$HDR_BACKUP"
  fi
  echo ">>> COPY $HDR_BACKUP (and $KEY) OFF THIS PI NOW (e.g. scp to your laptop / password manager)."
  echo ">>> Without the header backup, header damage = total data loss."

  info "Open, mkfs, mount"
  run cryptsetup open --key-file "$KEY" "$part" "$MAPPER"
  run mkfs.ext4 -q -L "$FSLABEL" "/dev/mapper/$MAPPER"
  run mkdir -p "$MNT"
  # Immutable bit on the *empty mountpoint* so nothing can silently write to the
  # SD card if the SSD is absent. Best effort.
  run chattr +i "$MNT" 2>/dev/null || echo "(chattr +i not supported here; skipped)"
  run mount "/dev/mapper/$MAPPER" "$MNT"
  run mkdir -p "$MNT/garage"
  info "Done. Next: '$0 install-boot' to auto-unlock at boot."
}

# ---- unlock / lock / status ------------------------------------------------
cmd_unlock() {
  need_cmds cryptsetup; [ "$DRY" = 1 ] || need_root
  local part; part=$(find_luks_dev)
  [ -n "$part" ] || die "LUKS partition (label $LUKSLABEL) not found - is the SSD plugged in?"
  if [ -e "/dev/mapper/$MAPPER" ]; then echo "already open"; else
    if [ -r "$KEY" ]; then run cryptsetup open --key-file "$KEY" "$part" "$MAPPER"
    else echo "no keyfile at $KEY; asking for passphrase"; run cryptsetup open "$part" "$MAPPER"; fi
  fi
  run mkdir -p "$MNT"
  if mountpoint -q "$MNT"; then echo "already mounted"; else run mount "/dev/mapper/$MAPPER" "$MNT"; fi
}

cmd_lock() {
  need_cmds cryptsetup; [ "$DRY" = 1 ] || need_root
  if mountpoint -q "$MNT"; then run umount "$MNT"; else echo "$MNT not mounted"; fi
  if [ -e "/dev/mapper/$MAPPER" ]; then run cryptsetup close "$MAPPER"; else echo "mapping not open"; fi
  [ "$DRY" = 1 ] || detach_loop
}

cmd_status() {
  need_cmds cryptsetup lsblk
  local part; part=$(find_luks_dev || true)
  echo "LUKS partition: ${part:-not found}"
  if [ -e "/dev/mapper/$MAPPER" ]; then echo "mapping: open"; cryptsetup status "$MAPPER" | sed 's/^/  /'; else echo "mapping: closed"; fi
  if mountpoint -q "$MNT"; then echo "mount: $MNT"; df -h "$MNT" | sed 's/^/  /'; else echo "mount: $MNT not mounted"; fi
  if [ -n "$part" ] && [ "$(id -u)" = 0 ]; then
    echo "keyslots:"; cryptsetup luksDump "$part" | awk '/^Keyslots:/{f=1} /^Tokens:/{f=0} f && /^  [0-9]+: /' | sed 's/^/  /'
  fi
  if [ -f "$KEY" ]; then echo "keyfile: $KEY present ($(stat -c '%a %U' "$KEY"))"; else echo "keyfile: $KEY absent"; fi
  if [ -f "$HDR_BACKUP" ]; then echo "header backup: $HDR_BACKUP present"; else echo "header backup: $HDR_BACKUP absent"; fi
}

# ---- install-boot ----------------------------------------------------------
cmd_install_boot() {
  [ "$DRY" = 1 ] || need_root
  local part luuid fuuid
  part=$(find_luks_dev); [ -n "$part" ] || die "LUKS partition not found"
  luuid=$(blkid -s UUID -o value "$part")
  [ -e "/dev/mapper/$MAPPER" ] || die "mapping $MAPPER not open; run unlock first (needed to read the filesystem UUID)"
  fuuid=$(blkid -s UUID -o value "/dev/mapper/$MAPPER")
  [ -n "$luuid" ] && [ -n "$fuuid" ] || die "could not read UUIDs"
  local opts="nofail,x-systemd.device-timeout=10"
  local cline="$MAPPER UUID=$luuid $KEY luks,$opts"
  local fline="UUID=$fuuid $MNT ext4 defaults,$opts 0 2"
  info "crypttab line: $cline"
  info "fstab line:    $fline"
  if [ "$DRY" = 1 ]; then echo "[dry-run] would back up $CRYPTTAB/$FSTAB and replace '$MARK' lines"; return; fi
  for f in "$CRYPTTAB" "$FSTAB"; do
    [ -e "$f" ] || : > "$f"
    cp -a "$f" "$f.bak.$(date +%Y%m%d%H%M%S)"
    sed -i "/^$MARK\$/,+1d" "$f"
  done
  printf '%s\n%s\n' "$MARK" "$cline" >> "$CRYPTTAB"
  printf '%s\n%s\n' "$MARK" "$fline" >> "$FSTAB"
  if [ -z "$TEST_LOOP" ]; then systemctl daemon-reload || true; fi
  cat <<EOF

Boot integration written. TRADEOFF: the keyfile $KEY lives on the SD card, so
this Pi auto-unlocks the SSD at boot with no operator. Theft of the SSD alone
yields only ciphertext. Theft of the Pi AND the SSD together defeats the
encryption (the key is on the SD card). Because of nofail + device-timeout=10 a
missing SSD never blocks boot. Verify with: findmnt $MNT ; systemctl --failed
EOF
}

# ---- main ------------------------------------------------------------------
args=()
for a in "$@"; do case "$a" in --dry-run) DRY=1;; *) args+=("$a");; esac; done
set -- "${args[@]:-}"
sub="${1:-}"; shift || true
case "$sub" in
  inspect)      cmd_inspect ;;
  format)       cmd_format "${1:-}" ;;
  unlock)       cmd_unlock ;;
  lock)         cmd_lock ;;
  status)       cmd_status ;;
  install-boot) cmd_install_boot ;;
  *) sed -n '2,16p' "$0"; exit 1 ;;
esac
