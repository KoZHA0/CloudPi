# CloudPi Raspberry Pi Setup Guide

This guide takes a fresh Raspberry Pi from first boot to a running CloudPi deployment using:

- Raspberry Pi OS Lite 64-bit
- Docker Compose
- Tailscale HTTPS
- LUKS encrypted storage

Target paths and names used throughout:

- Pi user: `pi`
- Project directory: `/home/pi/cloudpi`
- App URL: `https://<pi-hostname>.<tailnet>.ts.net`
- LUKS mount point: `/media/cloudpi-data`

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
sudo apt install -y git curl ca-certificates gnupg jq openssl cryptsetup lsblk sqlite3
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
ls docker-compose.yml Dockerfile backend/server.js frontend/package.json deploy/cloudpi-luks-setup.sh
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
- `CLOUDPI_ENCRYPTION_KEY` protects stored SMTP passwords and signs external drive IDs. It must be exactly 64 hex characters.
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

## 8. Prepare Encrypted LUKS Storage

CloudPi can store its database, uploads, and internal storage on an encrypted LUKS partition mounted at `/media/cloudpi-data`.

Warning: the setup script formats the selected partition. It destroys all data on that partition. Do not continue until you are certain which device is the external storage partition.

Plug in the USB SSD, USB hard drive, or USB flash drive you want to use for encrypted CloudPi storage.

List block devices:

```bash
lsblk -o NAME,SIZE,FSTYPE,TYPE,MOUNTPOINT,MODEL
```

Typical examples:

- Pi boot storage: `mmcblk0`, `mmcblk0p1`, `mmcblk0p2`
- External USB storage: `sda`, `sda1`

In most simple USB-drive setups, the target partition is `/dev/sda1`, but always confirm with `lsblk`.

Run the CloudPi LUKS bootstrap:

```bash
cd /home/pi/cloudpi
sudo bash deploy/cloudpi-luks-setup.sh
```

When prompted:

1. Select the target partition, for example `/dev/sda1`.
2. Keep mapper name as `cloudpi-data` unless you have a reason to change it.
3. Keep mount point as `/media/cloudpi-data`.
4. Enter and confirm a strong LUKS passphrase.
5. Type the exact destructive confirmation requested by the script.

The script will:

- Format the selected partition as LUKS2.
- Create an ext4 filesystem inside it.
- Mount it at `/media/cloudpi-data`.
- Create CloudPi data directories.
- Write root `.env` values used by `docker-compose.yml`.
- Start the Docker stack with the encrypted bind mounts.

The root `.env` file should contain values like:

```text
LUKS_DEVICE=/dev/disk/by-uuid/<uuid>
LUKS_MAPPER_NAME=cloudpi-data
LUKS_MOUNT_POINT=/media/cloudpi-data
CLOUDPI_INTERNAL_STORAGE_REQUIRES_LUKS=1
CLOUDPI_DB_MOUNT=/media/cloudpi-data/appdata
CLOUDPI_STORAGE_MOUNT=/media/cloudpi-data/storage
CLOUDPI_UPLOADS_MOUNT=/media/cloudpi-data/uploads
```

Check LUKS status:

```bash
sudo bash deploy/cloudpi-luks-stack.sh status
```

## 9. Build And Start CloudPi

If the LUKS bootstrap already started the stack, rebuild once after all hostname changes:

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
4. Check the LUKS or storage status in the admin area.
5. Upload a small test file.
6. Download or preview the file to confirm storage works.

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

## LUKS Operations

Check encrypted storage status:

```bash
cd /home/pi/cloudpi
sudo bash deploy/cloudpi-luks-stack.sh status
```

Lock encrypted storage and stop CloudPi:

```bash
cd /home/pi/cloudpi
sudo bash deploy/cloudpi-luks-stack.sh lock
```

Unlock encrypted storage and start CloudPi:

```bash
cd /home/pi/cloudpi
sudo bash deploy/cloudpi-luks-stack.sh unlock --start
```

Start Docker only if the encrypted mount is already present:

```bash
cd /home/pi/cloudpi
sudo bash deploy/cloudpi-luks-stack.sh start
```

## Optional USB Drive Auto-Mounting

CloudPi includes host scripts for external USB drive detection and notifications.

Run this only after the main app is working:

```bash
cd /home/pi/cloudpi
sudo bash deploy/harden-usb-mounts.sh
```

The script prints a `CLOUDPI_UDEV_SECRET=...` value. If you want event notifications to use that generated secret, copy it into `backend/.env` and restart:

```bash
cd /home/pi/cloudpi
nano backend/.env
docker compose up -d
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
- LUKS storage paths are configured but `/media/cloudpi-data` is not mounted.

Validate environment files:

```bash
cd /home/pi/cloudpi
test -f backend/.env && echo "backend/.env exists"
test -f .env && echo "root .env exists"
grep -E '^(NODE_ENV|PORT|CLOUDPI_ALLOWED_ORIGINS)=' backend/.env
grep -E '^(LUKS_DEVICE|LUKS_MOUNT_POINT|CLOUDPI_DB_MOUNT|CLOUDPI_STORAGE_MOUNT|CLOUDPI_UPLOADS_MOUNT)=' .env
```

### Wrong LUKS Device

Check devices:

```bash
lsblk -o NAME,SIZE,FSTYPE,TYPE,MOUNTPOINT,MODEL
sudo blkid
```

Check CloudPi's configured LUKS device:

```bash
cd /home/pi/cloudpi
grep '^LUKS_DEVICE=' .env
```

Prefer persistent `/dev/disk/by-uuid/<uuid>` paths over `/dev/sda1`, because `/dev/sdX` names can change across boots.

### LUKS Is Locked After Reboot

Unlock and start:

```bash
cd /home/pi/cloudpi
sudo bash deploy/cloudpi-luks-stack.sh unlock --start
```

Then verify:

```bash
sudo bash deploy/cloudpi-luks-stack.sh status
docker compose ps
```

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
- `sudo bash deploy/cloudpi-luks-stack.sh status` shows the encrypted mount is ready.
- A small file upload succeeds from the web UI.
- The uploaded file can be downloaded or previewed.

## Reference Docs

- Raspberry Pi Imager and first boot: https://www.raspberrypi.com/documentation/installation/installing-images/
- Docker on Debian: https://docs.docker.com/engine/install/debian/
- Docker on Raspberry Pi OS 32-bit: https://docs.docker.com/engine/install/raspberry-pi-os/
- Tailscale Linux install: https://tailscale.com/docs/install/linux
- Tailscale HTTPS certificates: https://tailscale.com/docs/how-to/set-up-https-certificates
