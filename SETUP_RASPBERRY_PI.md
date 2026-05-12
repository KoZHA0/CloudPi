# CloudPi Raspberry Pi Setup Guide

This guide takes a fresh Raspberry Pi from first boot to a running CloudPi deployment using:

- Raspberry Pi OS Lite 64-bit
- Docker Compose
- Tailscale HTTPS
- Application-level AES-256-GCM file encryption

Target paths and names used throughout:

- Pi user: `pi`
- Project directory: `/home/pi/cloudpi`
- App URL: `https://<pi-hostname>.<tailnet>.ts.net`
- Internal storage: Docker-managed volumes, or optional bind mounts you choose
- External USB drive mount root: `/media/pi`

Replace placeholder values like `<pi-hostname>.<tailnet>.ts.net` with the values from your Raspberry Pi.

## 1. Prepare Raspberry Pi OS

On another computer, install Raspberry Pi Imager:

https://www.raspberrypi.com/documentation/installation/installing-images/

In Raspberry Pi Imager:

1. Choose your Raspberry Pi model.
2. Choose `Raspberry Pi OS Lite (64-bit)`.
3. Choose the microSD card or boot drive.
4. Open OS customisation.
5. Set the hostname, for example `cloudpi`.
6. Set the username to `pi`.
7. Set a strong password.
8. Configure Wi-Fi if you are not using Ethernet.
9. Set your locale, timezone, and keyboard layout.
10. Enable SSH.
11. Write the image.

Insert the card or boot drive into the Raspberry Pi and power it on. Wait a few minutes for first boot.

Connect from your computer:

```bash
ssh pi@cloudpi.local
```

If `cloudpi.local` does not resolve, find the Pi IP address from your router and connect with:

```bash
ssh pi@<pi-ip-address>
```

## 2. Update The Pi

Run these commands after your first SSH login:

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y git curl ca-certificates gnupg jq openssl sqlite3 util-linux
sudo reboot
```

Reconnect after reboot:

```bash
ssh pi@cloudpi.local
```

## 3. Install Docker Engine And Compose

CloudPi targets Raspberry Pi OS Lite 64-bit, so use Docker's Debian repository instructions:

https://docs.docker.com/engine/install/debian/

Install Docker:

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Allow the `pi` user to run Docker commands:

```bash
sudo usermod -aG docker pi
sudo reboot
```

Reconnect and verify Docker:

```bash
ssh pi@cloudpi.local
docker --version
docker compose version
docker run --rm hello-world
```

Note: if you install 32-bit Raspberry Pi OS instead, use Docker's Raspberry Pi OS instructions:

https://docs.docker.com/engine/install/raspberry-pi-os/

## 4. Install Tailscale And Enable HTTPS

Install Tailscale:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Open the login URL printed by `tailscale up` and authenticate the Pi.

In the Tailscale admin console:

1. Enable MagicDNS.
2. Enable HTTPS certificates.
3. Consider disabling key expiry for this Pi if it will run as a home server.

Tailscale install docs:

https://tailscale.com/docs/install/linux

Tailscale HTTPS docs:

https://tailscale.com/docs/how-to/set-up-https-certificates

Find the full MagicDNS hostname:

```bash
tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//'
```

The output should look like:

```text
cloudpi.tail00000.ts.net
```

Save it in a shell variable for the rest of the setup:

```bash
TS_HOSTNAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
echo "$TS_HOSTNAME"
```

Generate Tailscale TLS certificate files where the current Docker Compose stack expects them:

```bash
sudo tailscale cert \
  --cert-file "/etc/ssl/certs/${TS_HOSTNAME}.crt" \
  --key-file "/etc/ssl/private/${TS_HOSTNAME}.key" \
  "$TS_HOSTNAME"
```

Set private-key permissions:

```bash
sudo chmod 600 "/etc/ssl/private/${TS_HOSTNAME}.key"
sudo chmod 644 "/etc/ssl/certs/${TS_HOSTNAME}.crt"
```

## 5. Put CloudPi On The Pi

Clone or copy this repository to `/home/pi/cloudpi`.

If the repository is hosted in Git:

```bash
cd /home/pi
git clone <your-cloudpi-repository-url> cloudpi
cd /home/pi/cloudpi
```

If you copied the project by another method, make sure the final path is:

```text
/home/pi/cloudpi
```

and verify the expected files exist:

```bash
cd /home/pi/cloudpi
ls docker-compose.yml Dockerfile backend/server.js frontend/package.json deploy/docker-nginx.conf
```

## 6. Create Backend Environment

Create `backend/.env`:

```bash
cd /home/pi/cloudpi
TS_HOSTNAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
test -n "$TS_HOSTNAME"
mkdir -p backend
cat > backend/.env <<EOF
NODE_ENV=production
PORT=3001
JWT_SECRET=$(openssl rand -hex 64)
CLOUDPI_ENCRYPTION_KEY=$(openssl rand -hex 32)
CLOUDPI_ALLOWED_ORIGINS=https://${TS_HOSTNAME}
CLOUDPI_UDEV_SECRET=$(openssl rand -hex 32)
EOF
chmod 600 backend/.env
```

These values are important:

- `JWT_SECRET` signs login tokens. It must be strong in production.
- `CLOUDPI_ENCRYPTION_KEY` protects AES-256-GCM file encryption, stored SMTP passwords, and signed external drive IDs. It must be exactly 64 hex characters.
- `CLOUDPI_ALLOWED_ORIGINS` allows the Tailscale HTTPS origin.
- `CLOUDPI_UDEV_SECRET` authenticates host USB drive-change notifications.

Show the file without exposing secrets:

```bash
grep -E '^(NODE_ENV|PORT|CLOUDPI_ALLOWED_ORIGINS)=' backend/.env
```

## 7. Configure Tailscale Hostname In CloudPi

This repository currently contains a sample hard-coded Tailscale hostname in:

- `docker-compose.yml`
- `deploy/docker-nginx.conf`

Replace the sample hostname and certificate paths with your real Tailscale hostname:

```bash
cd /home/pi/cloudpi
TS_HOSTNAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
test -n "$TS_HOSTNAME"
OLD_HOST="pi.taild54945.ts.net"
sed -i "s/${OLD_HOST}/${TS_HOSTNAME}/g" docker-compose.yml deploy/docker-nginx.conf
```

Verify the substitutions:

```bash
grep -R "$TS_HOSTNAME" docker-compose.yml deploy/docker-nginx.conf
grep -R "taild54945" docker-compose.yml deploy/docker-nginx.conf || true
```

## 8. Prepare Storage And Encryption

CloudPi no longer uses LUKS. Files are encrypted by the Node.js backend with AES-256-GCM before they are written to disk when the admin encryption toggle is enabled.

The encryption key comes from:

```text
backend/.env -> CLOUDPI_ENCRYPTION_KEY
```

Keep this key safe. If you lose it, encrypted files cannot be decrypted.

By default, Docker stores CloudPi data in named volumes:

```text
cloudpi-db       -> SQLite database at /data/cloudpi.db
cloudpi-storage  -> internal file storage at /app/backend/storage
cloudpi-uploads  -> profile uploads at /app/backend/uploads
```

For most installs, no root `.env` file is needed. Use the default Docker volumes unless you intentionally want bind mounts.

Optional bind mounts:

```bash
cd /home/pi/cloudpi
mkdir -p /home/pi/cloudpi-data/db /home/pi/cloudpi-data/storage /home/pi/cloudpi-data/uploads
sudo chown -R 1000:1000 /home/pi/cloudpi-data
cat > .env <<'EOF'
CLOUDPI_DB_MOUNT=/home/pi/cloudpi-data/db
CLOUDPI_STORAGE_MOUNT=/home/pi/cloudpi-data/storage
CLOUDPI_UPLOADS_MOUNT=/home/pi/cloudpi-data/uploads
EOF
```

Do not run the old LUKS scripts for the AES-256-GCM version:

```text
deploy/cloudpi-luks-setup.sh
deploy/cloudpi-luks-stack.sh
```

Those scripts belong to the retired LUKS architecture.

### Cleanup From The Old LUKS Version

Skip this subsection on a fresh Pi.

If this Pi already ran the old LUKS version, stop CloudPi and remove the old root `.env` overrides before starting the new version:

```bash
cd /home/pi/cloudpi
docker compose down --remove-orphans
mv .env .env.luks.old 2>/dev/null || true
```

If you want a completely fresh CloudPi install, remove the old Docker volumes too:

```bash
docker compose down -v --remove-orphans
docker volume rm cloudpi_cloudpi-db cloudpi_cloudpi-storage cloudpi_cloudpi-uploads 2>/dev/null || true
```

Only wipe the old LUKS disk if you are certain you no longer need its data. First identify the device:

```bash
lsblk -o NAME,PATH,SIZE,FSTYPE,LABEL,MOUNTPOINTS,MODEL
```

Example for an old LUKS partition at `/dev/sda1`:

```bash
sudo umount /media/cloudpi-data 2>/dev/null || true
sudo cryptsetup luksClose cloudpi-data 2>/dev/null || true
sudo wipefs -n /dev/sda1
```

If the dry run shows the expected old LUKS signature and `/dev/sda1` is definitely the correct partition, wipe it:

```bash
sudo wipefs -a /dev/sda1
sudo dd if=/dev/zero of=/dev/sda1 bs=1M count=32 conv=fsync
sudo mkfs.ext4 -F -L cloudpi-usb /dev/sda1
```

Remove old host-level LUKS leftovers:

```bash
sudo rm -f /etc/sudoers.d/cloudpi-luks
sudo rmdir /media/cloudpi-data 2>/dev/null || true
sudo grep -n "cloudpi-data\|LUKS" /etc/fstab /etc/crypttab 2>/dev/null || true
```

If the last command prints matching `/etc/fstab` or `/etc/crypttab` lines, remove only the CloudPi LUKS lines from those files.

## 9. Build And Start CloudPi

Build and start the stack after the hostname and environment files are ready:

```bash
cd /home/pi/cloudpi
docker compose up -d --build
```

Validate the Compose file:

```bash
docker compose config >/tmp/cloudpi-compose-rendered.yml
```

Check containers:

```bash
docker compose ps
```

Follow logs:

```bash
docker compose logs -f
```

Check the backend API through HTTPS:

```bash
TS_HOSTNAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
curl -k "https://${TS_HOSTNAME}/api/test"
```

Expected response includes:

```json
{
  "message": "CloudPi Backend is running!",
  "database": "Connected"
}
```

## 10. Finish Setup In The Browser

Open:

```text
https://<pi-hostname>.<tailnet>.ts.net
```

For example:

```text
https://cloudpi.tail00000.ts.net
```

Complete the first-run setup:

1. Create the first admin account.
2. Save the recovery or backup code if CloudPi shows one.
3. Sign in.
4. Open Settings and confirm the File Encryption card loads.
5. Enable "Encrypt new uploads" if you want all new uploads encrypted on disk.
6. Upload a small test file.
7. Download or preview the file to confirm storage works.

## Daily Operation

Show running services:

```bash
cd /home/pi/cloudpi
docker compose ps
```

View logs:

```bash
cd /home/pi/cloudpi
docker compose logs -f
docker compose logs -f backend
docker compose logs -f nginx
```

Stop CloudPi:

```bash
cd /home/pi/cloudpi
docker compose down
```

Start CloudPi:

```bash
cd /home/pi/cloudpi
docker compose up -d
```

Rebuild after code changes:

```bash
cd /home/pi/cloudpi
docker compose up -d --build
```

Update from Git:

```bash
cd /home/pi/cloudpi
git pull
docker compose up -d --build
```

## Encryption Operations

Check that the application encryption key is configured:

```bash
cd /home/pi/cloudpi
awk -F= '/^CLOUDPI_ENCRYPTION_KEY=/{ print length($2) " hex characters configured" }' backend/.env
```

The value must be exactly 64 hex characters after the `=`.

Enable encryption for new uploads from the web UI:

```text
Settings -> File Encryption -> Encrypt new uploads
```

Or enable it from the Pi shell:

```bash
cd /home/pi/cloudpi
docker compose exec backend node -e "const Database=require('better-sqlite3'); const db=new Database('/data/cloudpi.db'); db.prepare(\"UPDATE settings SET value='1' WHERE key='encryption_enabled'\").run(); console.log('encryption enabled')"
docker compose restart backend
```

Check encryption file counts from the database:

```bash
cd /home/pi/cloudpi
docker compose exec backend node -e "const Database=require('better-sqlite3'); const db=new Database('/data/cloudpi.db'); console.log(db.prepare(\"SELECT key,value FROM settings WHERE key='encryption_enabled'\").get()); console.log(db.prepare(\"SELECT encrypted, COUNT(*) count FROM files WHERE type!='folder' GROUP BY encrypted\").all())"
```

The Settings page shows the same counts in the File Encryption card.

## Optional USB Drive Auto-Mounting

CloudPi includes host scripts for external USB drive detection and notifications.

Run this only after the main app is working:

```bash
cd /home/pi/cloudpi
sudo bash deploy/harden-usb-mounts.sh
```

The script installs common filesystem helpers and mounts supported USB filesystems under `/media/pi`:

```text
exFAT, FAT32, NTFS, ext2/3/4, XFS, Btrfs, F2FS
```

It supports normal partitions such as `/dev/sda1` and whole-disk filesystems such as `/dev/sda`. A blank disk or a disk with only a partition table is not mountable until you create and format a partition.

The script prints a `CLOUDPI_UDEV_SECRET=...` value. If you want event notifications to use that generated secret, copy it into `backend/.env` and restart:

```bash
cd /home/pi/cloudpi
nano backend/.env
docker compose up -d
```

After installing the automount rules, reboot once, then unplug and replug the USB drive:

```bash
sudo reboot
```

Check the mount:

```bash
lsblk -o NAME,PATH,FSTYPE,SIZE,MOUNTPOINTS,MODEL
mount | grep /media/pi
```

## Troubleshooting

### Browser Cannot Reach CloudPi

Check Tailscale status:

```bash
tailscale status
tailscale ip
```

Check containers:

```bash
cd /home/pi/cloudpi
docker compose ps
```

Check whether Nginx is listening on ports 80 and 443:

```bash
sudo ss -tulpn | grep -E ':80|:443'
```

If another host service is using those ports, stop it or change the Compose port mapping.

### Certificate Path Mismatch

Confirm the cert files exist:

```bash
TS_HOSTNAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
echo "$TS_HOSTNAME"
sudo ls -l "/etc/ssl/certs/${TS_HOSTNAME}.crt" "/etc/ssl/private/${TS_HOSTNAME}.key"
```

Confirm `docker-compose.yml` references the same hostname:

```bash
cd /home/pi/cloudpi
grep -n "$TS_HOSTNAME" docker-compose.yml deploy/docker-nginx.conf
```

Regenerate the certificate if needed:

```bash
TS_HOSTNAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
sudo tailscale cert \
  --cert-file "/etc/ssl/certs/${TS_HOSTNAME}.crt" \
  --key-file "/etc/ssl/private/${TS_HOSTNAME}.key" \
  "$TS_HOSTNAME"
```

Restart Nginx container:

```bash
cd /home/pi/cloudpi
docker compose restart nginx
```

### Backend Is Unhealthy

Read backend logs:

```bash
cd /home/pi/cloudpi
docker compose logs --tail=100 backend
```

Common causes:

- `backend/.env` does not exist.
- `JWT_SECRET` is missing.
- `CLOUDPI_ENCRYPTION_KEY` is not exactly 64 hex characters.
- A leftover root `.env` from the old LUKS deployment is overriding Docker volumes.
- The Tailscale hostname in `docker-compose.yml` or `deploy/docker-nginx.conf` does not match the certificate files.

Validate environment files:

```bash
cd /home/pi/cloudpi
test -f backend/.env && echo "backend/.env exists"
grep -E '^(NODE_ENV|PORT|CLOUDPI_ALLOWED_ORIGINS)=' backend/.env
awk -F= '/^CLOUDPI_ENCRYPTION_KEY=/{ print length($2) " hex characters configured" }' backend/.env
test -f .env && cat .env || true
```

If `.env` contains old `LUKS_...` values, rename it and restart:

```bash
cd /home/pi/cloudpi
mv .env .env.luks.old
docker compose up -d
```

### Encryption Toggle Is Off

`CLOUDPI_ENCRYPTION_KEY` only makes encryption possible. New uploads are encrypted only when the admin setting is enabled.

Enable it in:

```text
Settings -> File Encryption -> Encrypt new uploads
```

Existing files are not rewritten when you toggle this setting. Files uploaded before encryption was enabled remain unencrypted until they are re-uploaded.

### Re-run Compose Validation

After editing `docker-compose.yml`, always validate:

```bash
cd /home/pi/cloudpi
docker compose config >/tmp/cloudpi-compose-rendered.yml
```

If validation fails, fix the reported line before starting the stack.

## Runtime Acceptance Checklist

The setup is complete when all checks pass:

- `docker compose ps` shows `cloudpi-backend` healthy and `cloudpi-nginx` running.
- `curl -k "https://${TS_HOSTNAME}/api/test"` returns CloudPi backend JSON.
- `https://${TS_HOSTNAME}` loads the CloudPi setup or login page.
- The first admin account can be created.
- The Settings page shows the File Encryption card.
- "Encrypt new uploads" can be enabled.
- A small file upload succeeds from the web UI.
- The uploaded file can be downloaded or previewed.

## Reference Docs

- Raspberry Pi Imager and first boot: https://www.raspberrypi.com/documentation/installation/installing-images/
- Docker on Debian: https://docs.docker.com/engine/install/debian/
- Docker on Raspberry Pi OS 32-bit: https://docs.docker.com/engine/install/raspberry-pi-os/
- Tailscale Linux install: https://tailscale.com/docs/install/linux
- Tailscale HTTPS certificates: https://tailscale.com/docs/how-to/set-up-https-certificates
