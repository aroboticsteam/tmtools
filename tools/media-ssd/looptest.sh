#!/bin/bash
set -uo pipefail
T=/var/tmp/mtest; IMG=$T/test.img
export MEDIA_SSD_TEST_LOOP=$IMG MEDIA_KEY=$T/media.key MEDIA_MNT=$T/mnt MEDIA_MAPPER=tmtestmedia \
  MEDIA_HDR_BACKUP=$T/hdr.img MEDIA_CRYPTTAB=$T/crypttab MEDIA_FSTAB=$T/fstab
S=$T/media-ssd.sh
rm -f $IMG $MEDIA_KEY $MEDIA_HDR_BACKUP $MEDIA_CRYPTTAB $MEDIA_FSTAB; chattr -i $MEDIA_MNT 2>/dev/null; truncate -s 256M $IMG
echo "### dry-run format"; $S --dry-run format $IMG; echo "exit=$?"
echo "### wrong serial"; echo WRONG | $S format $IMG; echo "exit=$?"
echo "### real format (serial TESTLOOP, no passphrase slot)"; printf 'TESTLOOP\nn\n' | $S format $IMG; echo "exit=$?"
ls -l $MEDIA_KEY $MEDIA_HDR_BACKUP | awk '{print $1,$3,$5,$9}'
echo "### write file"; head -c 20000000 /dev/urandom > $MEDIA_MNT/garage/blob; SUM1=$(sha256sum $MEDIA_MNT/garage/blob | cut -d' ' -f1); echo $SUM1
echo "### status"; $S status
echo "### lock"; $S lock; echo "exit=$?"; losetup -a | grep test.img; ls /dev/mapper
echo "### wrong key rejected"; head -c 64 /dev/urandom > $T/wrong.key
LD=$(losetup -fP --show $IMG); P=${LD}p1
cryptsetup open --test-passphrase --key-file $T/wrong.key $P && echo "BAD: wrong key accepted" || echo "wrong key rejected (exit $?)"
cryptsetup open --test-passphrase --key-file $MEDIA_KEY $P && echo "right key accepted"
losetup -d $LD
echo "### unlock"; $S unlock; echo "exit=$?"
SUM2=$(sha256sum $MEDIA_MNT/garage/blob | cut -d' ' -f1); [ "$SUM1" = "$SUM2" ] && echo "checksum MATCH after reopen" || echo "checksum MISMATCH"
echo "### install-boot"; $S install-boot; echo "exit=$?"; echo "--crypttab"; cat $MEDIA_CRYPTTAB; echo "--fstab"; cat $MEDIA_FSTAB
echo "### install-boot again (idempotent)"; $S install-boot >/dev/null; echo "crypttab lines: $(wc -l < $MEDIA_CRYPTTAB)  fstab lines: $(wc -l < $MEDIA_FSTAB)"
echo "### header backup/restore: corrupt header, restore"
$S lock
LD=$(losetup -fP --show $IMG); P=${LD}p1
dd if=/dev/zero of=$P bs=1M count=4 conv=notrunc status=none   # loop partition only
cryptsetup open --test-passphrase --key-file $MEDIA_KEY $P 2>&1 | head -1; echo "(header destroyed above)"
cryptsetup luksHeaderRestore --batch-mode $P --header-backup-file $MEDIA_HDR_BACKUP && echo restored
cryptsetup open --key-file $MEDIA_KEY $P $MEDIA_MAPPER && mount /dev/mapper/$MEDIA_MAPPER $MEDIA_MNT
SUM3=$(sha256sum $MEDIA_MNT/garage/blob | cut -d' ' -f1); [ "$SUM1" = "$SUM3" ] && echo "checksum MATCH after header restore" || echo "checksum MISMATCH after restore"
umount $MEDIA_MNT; cryptsetup close $MEDIA_MAPPER; losetup -d $LD
