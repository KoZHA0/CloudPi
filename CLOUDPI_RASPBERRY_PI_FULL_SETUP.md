# CloudPi Raspberry Pi Full Setup Guide

Fresh install guide from a blank Raspberry Pi to opening CloudPi in the browser.

This guide uses the current CloudPi production path:

- Raspberry Pi OS Lite 64-bit
- Docker + Docker Compose
- Tailscale private network
- Tailscale HTTPS certificates
- Nginx container for the frontend and reverse proxy
- Node.js backend inside Docker
- SQLite database in a Docker volume
- Optional USB drive automount for external storage

Every command includes a short comment explaining what it does.

## 0. What You Need

Tools and accounts:

- **Raspberry Pi Imager**: writes Raspberry Pi OS to the microSD card or SSD.
- **Raspberry Pi OS Lite 64-bit**: recommended server OS.
- **SSH client**: connects from your computer to the Pi terminal.
- **Git**: downloads the CloudPi project.
- **Docker Engine**: runs the CloudPi backend and Nginx containers.
- **Docker Compose plugin**: starts the full CloudPi stack from `docker-compose.yml`.
- **Tailscale account**: private network access to the Pi.
- **Tailscale HTTPS**: trusted HTTPS certificate for the private `.ts.net` address.
- **OpenSSL**: generates strong secrets for CloudPi.
- **jq**: reads Tailscale JSON output.
- **A browser**: opens the CloudPi web UI.

Names used in this guide:

```text
Pi username:      pi
Pi hostname:      cloudpi
Project path:     /home/pi/cloudpi
Web URL:          https://<your-pi-name>.<your-tailnet>.ts.net
USB mount root:   /media/pi
```

Replace placeholders like `<your-repo-url>` and `<your-pi-name>.<your-tailnet>.ts.net` with your real values.

## 1. Flash Raspberry Pi OS

Do this on your main computer, not on the Pi.

1. Open **Raspberry Pi Imager**.
2. Choose your Raspberry Pi model.
3. Choose **Raspberry Pi OS Lite 64-bit**.
4. Choose your microSD card or SSD.
5. Open OS customisation.
6. Set hostname to `cloudpi`.
7. Set username to `pi`.
8. Set a strong password.
9. Configure Wi-Fi if you are not using Ethernet.
10. Set locale, timezone, and keyboard layout.
11. Enable SSH.
12. Write the image.

After writing, put the card or drive into the Raspberry Pi and power it on.

Wait 2-5 minutes for first boot.

## 2. Connect To The Pi

Run these commands from your main computer terminal.

```bash
# Connect to the Pi over SSH using its local hostname.
ssh pi@cloudpi.local
```

If `cloudpi.local` does not work, find the Pi IP from your router and use:

```bash
# Connect to the Pi over SSH using its IP address.
ssh pi@<pi-ip-address>
```

## 3. Update The Operating System

Run these commands on the Pi after logging in over SSH.

```bash
# Refresh the package list from Raspberry Pi OS repositories.
sudo apt update

# Install all available OS updates.
sudo apt full-upgrade -y

# Install base tools used throughout this setup.
sudo apt install -y git curl ca-certificates gnupg jq openssl sqlite3 util-linux nano

# Reboot so kernel and system updates are fully active.
sudo reboot
```

Reconnect after reboot:

```bash
# Reconnect to the Pi after it comes back online.
ssh pi@cloudpi.local
```

## 4. Install Docker And Docker Compose

Docker runs CloudPi without installing Node.js directly on the Pi host.

This guide expects **Raspberry Pi OS Lite 64-bit**. If Docker packages show
`no installation candidate`, first confirm the Pi is really using the 64-bit
`arm64` OS and that Docker's apt repository was added successfully.

```bash
# Refresh package metadata.
sudo apt update

# Install tools needed to add Docker's package repository.
sudo apt install -y ca-certificates curl

# Confirm the Pi is running the 64-bit OS expected by this guide.
# This should print: arm64
dpkg --print-architecture

# Confirm the OS codename apt will use for the Docker repository.
# On current Raspberry Pi OS this is usually: bookworm
. /etc/os-release && echo "$VERSION_CODENAME"

# Create the directory where apt stores trusted repository keys.
sudo install -m 0755 -d /etc/apt/keyrings

# Download Docker's official Debian repository signing key.
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc

# Make the Docker signing key readable by apt.
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Remove any old Docker apt source before writing the clean source file.
sudo rm -f /etc/apt/sources.list.d/docker.list /etc/apt/sources.list.d/docker.sources

# Add Docker's official Debian repository for Raspberry Pi OS 64-bit.
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

# Refresh package metadata again, now including Docker packages.
sudo apt update

# Confirm apt can see Docker packages before installing them.
apt-cache policy docker-ce

# Install Docker Engine, Docker CLI, containerd, buildx, and Compose plugin.
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Allow the pi user to run docker commands without sudo.
sudo usermod -aG docker pi

# Reboot so the new docker group membership applies.
sudo reboot
```

Reconnect:

```bash
# Reconnect to the Pi after Docker setup.
ssh pi@cloudpi.local
```

If `apt-cache policy docker-ce` shows `Candidate: (none)`, do not run the
install command yet:

- If `dpkg --print-architecture` printed anything other than `arm64`, re-flash
  with **Raspberry Pi OS Lite 64-bit** and repeat this section.
- If it printed `arm64`, read the output from `sudo apt update`; Docker source
  errors there usually point to the wrong codename or a failed signing key
  download.

Verify Docker:

```bash
# Show the installed Docker version.
docker --version

# Show the installed Docker Compose plugin version.
docker compose version

# Run Docker's test container to confirm Docker works.
docker run --rm hello-world
```

## 5. Install And Login To Tailscale

Tailscale lets you access CloudPi privately from your own devices.

```bash
# Install Tailscale using the official install script.
curl -fsSL https://tailscale.com/install.sh | sh

# Start Tailscale login for this Pi.
sudo tailscale up
```

Open the login URL printed by `tailscale up`, then approve the Pi in your Tailscale account.

Recommended Tailscale admin console settings:

- Enable **MagicDNS**.
- Enable **HTTPS certificates**.
- Consider disabling key expiry for this Pi.

Check the Pi's Tailscale status:

```bash
# Show devices in your tailnet and verify this Pi is connected.
tailscale status

# Show this Pi's Tailscale IP addresses.
tailscale ip
```

Get the full Tailscale DNS name:

```bash
# Read this Pi's MagicDNS hostname and remove the trailing dot.
tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//'
```

Save it in a shell variable:

```bash
# Store the Pi's Tailscale hostname for later commands.
TS_HOSTNAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"

# Print the hostname so you can verify it looks correct.
echo "$TS_HOSTNAME"
```

Example output:

```text
cloudpi.tail00000.ts.net
```

## 6. Generate Tailscale HTTPS Certificates

CloudPi's Nginx container expects certificate files on the Pi host.

```bash
# Store the Pi's Tailscale hostname again in case this is a new shell.
TS_HOSTNAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"

# Ask Tailscale to create an HTTPS certificate and private key for the Pi hostname.
sudo tailscale cert \
  --cert-file "/etc/ssl/certs/${TS_HOSTNAME}.crt" \
  --key-file "/etc/ssl/private/${TS_HOSTNAME}.key" \
  "$TS_HOSTNAME"

# Restrict the private key so only root can read it.
sudo chmod 600 "/etc/ssl/private/${TS_HOSTNAME}.key"

# Allow the certificate file to be read by services.
sudo chmod 644 "/etc/ssl/certs/${TS_HOSTNAME}.crt"

# Confirm both certificate files exist.
sudo ls -l "/etc/ssl/certs/${TS_HOSTNAME}.crt" "/etc/ssl/private/${TS_HOSTNAME}.key"
```

## 7. Download CloudPi

Use Git if your project is in a repository.

```bash
# Move to the pi user's home directory.
cd /home/pi

# Clone the CloudPi project into /home/pi/cloudpi.
git clone <your-repo-url> cloudpi

# Enter the CloudPi project directory.
cd /home/pi/cloudpi
```

If you copied the project another way, make sure it ends up here:

```bash
# Enter the expected CloudPi project directory.
cd /home/pi/cloudpi
```

Verify the important files:

```bash
# Confirm the Docker stack and app files exist.
ls docker-compose.yml Dockerfile backend/server.js frontend/package.json deploy/docker-nginx.conf
```

## 8. Create The Backend Environment File

CloudPi requires strong secrets before the backend starts.

```bash
# Enter the CloudPi project directory.
cd /home/pi/cloudpi

# Store the Pi's Tailscale hostname.
TS_HOSTNAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"

# Stop if the hostname variable is empty.
test -n "$TS_HOSTNAME"

# Create the backend folder if it does not already exist.
mkdir -p backend

# Create backend/.env with production settings and generated secrets.
cat > backend/.env <<EOF
NODE_ENV=production
PORT=3001
JWT_SECRET=$(openssl rand -hex 64)
CLOUDPI_ENCRYPTION_KEY=$(openssl rand -hex 32)
CLOUDPI_ALLOWED_ORIGINS=https://${TS_HOSTNAME}
CLOUDPI_UDEV_SECRET=$(openssl rand -hex 32)
EOF

# Restrict backend/.env because it contains secrets.
chmod 600 backend/.env
```

What these variables do:

- `NODE_ENV`: tells Node.js this is production.
- `PORT`: backend API port inside the container.
- `JWT_SECRET`: signs login/session tokens.
- `CLOUDPI_ENCRYPTION_KEY`: protects file encryption, SMTP secrets, and drive IDs.
- `CLOUDPI_ALLOWED_ORIGINS`: allows the Tailscale HTTPS site to call the API.
- `CLOUDPI_UDEV_SECRET`: authenticates USB plug/unplug webhooks from the Pi host.

Check the safe values without printing secrets:

```bash
# Show only non-secret environment values.
grep -E '^(NODE_ENV|PORT|CLOUDPI_ALLOWED_ORIGINS)=' backend/.env

# Confirm the encryption key is exactly 64 hex characters.
awk -F= '/^CLOUDPI_ENCRYPTION_KEY=/{ print length($2) " hex characters configured" }' backend/.env
```

The encryption key check should print:

```text
64 hex characters configured
```

## 9. Point Docker And Nginx To Your Tailscale Hostname

The repository currently has a sample Tailscale hostname in `docker-compose.yml` and `deploy/docker-nginx.conf`.

Replace it with your real hostname.

```bash
# Enter the CloudPi project directory.
cd /home/pi/cloudpi

# Store the Pi's Tailscale hostname.
TS_HOSTNAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"

# Stop if the hostname variable is empty.
test -n "$TS_HOSTNAME"

# Set the sample hostname currently used in the repo.
OLD_HOST="pi.taild54945.ts.net"

# Replace the sample hostname with your Pi's real Tailscale hostname.
sed -i "s/${OLD_HOST}/${TS_HOSTNAME}/g" docker-compose.yml deploy/docker-nginx.conf

# Confirm the real hostname appears in the deployment files.
grep -R "$TS_HOSTNAME" docker-compose.yml deploy/docker-nginx.conf

# Confirm the sample hostname is gone.
grep -R "$OLD_HOST" docker-compose.yml deploy/docker-nginx.conf || true
```

## 10. Choose Storage Mode

Recommended first setup: use Docker named volumes.

Docker named volumes are simple and safe:

- `cloudpi-db`: SQLite database.
- `cloudpi-storage`: internal CloudPi files.
- `cloudpi-uploads`: avatars/uploads metadata.

You do not need a root `.env` file for the default storage mode.

Optional: use bind mounts if you want CloudPi data in a visible host folder.

```bash
# Enter the CloudPi project directory.
cd /home/pi/cloudpi

# Create host folders for database, file storage, and uploads.
mkdir -p /home/pi/cloudpi-data/db /home/pi/cloudpi-data/storage /home/pi/cloudpi-data/uploads

# Give Docker's node user inside the backend container write access.
sudo chown -R 1000:1000 /home/pi/cloudpi-data

# Create root .env to override Docker volume locations.
cat > .env <<'EOF'
CLOUDPI_DB_MOUNT=/home/pi/cloudpi-data/db
CLOUDPI_STORAGE_MOUNT=/home/pi/cloudpi-data/storage
CLOUDPI_UPLOADS_MOUNT=/home/pi/cloudpi-data/uploads
EOF

# Show the bind mount settings.
cat .env
```

Skip this optional section unless you specifically want host folders.

## 11. Validate The Docker Compose Configuration

Before starting CloudPi, validate the final Compose file.

```bash
# Enter the CloudPi project directory.
cd /home/pi/cloudpi

# Render and validate the Docker Compose configuration.
docker compose config >/tmp/cloudpi-compose-rendered.yml

# Show the rendered file path.
ls -l /tmp/cloudpi-compose-rendered.yml
```

If this command fails, fix the reported line before continuing.

## 12. Build And Start CloudPi

This builds the frontend, backend, and Nginx images on the Pi.

```bash
# Enter the CloudPi project directory.
cd /home/pi/cloudpi

# Build images and start CloudPi in the background.
docker compose up -d --build
```

Check containers:

```bash
# Show CloudPi container status.
docker compose ps
```

Follow logs:

```bash
# Follow logs from all CloudPi containers.
docker compose logs -f
```

Follow only backend logs:

```bash
# Follow only the backend API logs.
docker compose logs -f backend
```

Follow only Nginx logs:

```bash
# Follow only the Nginx frontend/proxy logs.
docker compose logs -f nginx
```

## 13. Test The Backend API

Run this from the Pi.

```bash
# Store the Pi's Tailscale hostname.
TS_HOSTNAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"

# Call the backend test endpoint through HTTPS.
curl -k "https://${TS_HOSTNAME}/api/test"
```

Expected result should include:

```json
{
  "message": "CloudPi Backend is running!",
  "database": "Connected"
}
```

## 14. Open The Website

Open this URL from any device connected to your Tailscale network:

```text
https://<your-pi-name>.<your-tailnet>.ts.net
```

Example:

```text
https://cloudpi.tail00000.ts.net
```

First-run setup in the browser:

1. Create the first admin account.
2. Save any recovery or backup code shown.
3. Sign in.
4. Open **Settings**.
5. Check **File Encryption**.
6. Enable **Encrypt new uploads** if you want new files encrypted on disk.
7. Upload a small test file.
8. Preview or download the file to confirm CloudPi works.

## 15. Optional: Enable USB Drive Automount

Run this only after CloudPi itself works.

The USB script:

- installs filesystem helpers,
- mounts USB filesystems under `/media/pi`,
- applies safer mount options,
- creates CloudPi udev rules,
- notifies the backend when drives connect or disconnect.

```bash
# Enter the CloudPi project directory.
cd /home/pi/cloudpi

# Install CloudPi USB automount and drive event notification rules.
sudo bash deploy/harden-usb-mounts.sh
```

The script prints a `CLOUDPI_UDEV_SECRET=...` value.

Copy that value into `backend/.env`.

```bash
# Open backend/.env in a terminal text editor.
nano backend/.env
```

After editing, restart CloudPi:

```bash
# Restart the CloudPi stack so the backend reads the updated udev secret.
docker compose up -d
```

Reboot once so udev and mount propagation are clean:

```bash
# Reboot the Pi after installing USB automount rules.
sudo reboot
```

Reconnect:

```bash
# Reconnect to the Pi after reboot.
ssh pi@cloudpi.local
```

Plug in a USB drive, then check:

```bash
# Show disks, partitions, filesystems, sizes, and mount points.
lsblk -o NAME,PATH,FSTYPE,SIZE,MOUNTPOINTS,MODEL

# Show mounted USB drives under CloudPi's USB mount root.
mount | grep /media/pi

# Watch CloudPi USB event logs.
journalctl -t cloudpi-udev -f
```

In the CloudPi website:

1. Open **Admin**.
2. Use **Storage Manager**.
3. Click **Scan Drives**.
4. Give the USB drive a clear CloudPi label.
5. Register it.
6. Assign it to users if needed.

## 16. Useful Daily Commands

Start CloudPi:

```bash
# Start CloudPi containers in the background.
cd /home/pi/cloudpi
docker compose up -d
```

Stop CloudPi:

```bash
# Stop CloudPi containers without deleting data.
cd /home/pi/cloudpi
docker compose down
```

Restart CloudPi:

```bash
# Restart running CloudPi containers.
cd /home/pi/cloudpi
docker compose restart
```

Rebuild after code changes:

```bash
# Rebuild images and restart CloudPi with the new code.
cd /home/pi/cloudpi
docker compose up -d --build
```

Update from Git:

```bash
# Enter the CloudPi project directory.
cd /home/pi/cloudpi

# Pull the newest code from your repository.
git pull

# Rebuild and restart CloudPi after updating code.
docker compose up -d --build
```

Show container status:

```bash
# Show whether backend and Nginx containers are running and healthy.
cd /home/pi/cloudpi
docker compose ps
```

View logs:

```bash
# Show recent logs from all CloudPi containers.
cd /home/pi/cloudpi
docker compose logs --tail=100
```

Backup Docker volumes manually:

```bash
# Create a backup folder in the pi user's home directory.
mkdir -p /home/pi/cloudpi-backups

# Back up the SQLite database volume.
docker run --rm -v cloudpi_cloudpi-db:/data -v /home/pi/cloudpi-backups:/backup alpine tar czf /backup/cloudpi-db.tar.gz -C /data .

# Back up the internal storage volume.
docker run --rm -v cloudpi_cloudpi-storage:/data -v /home/pi/cloudpi-backups:/backup alpine tar czf /backup/cloudpi-storage.tar.gz -C /data .

# Back up the uploads volume.
docker run --rm -v cloudpi_cloudpi-uploads:/data -v /home/pi/cloudpi-backups:/backup alpine tar czf /backup/cloudpi-uploads.tar.gz -C /data .

# List backup files.
ls -lh /home/pi/cloudpi-backups
```

## 17. Troubleshooting

### Website Does Not Open

```bash
# Check that Tailscale is connected.
tailscale status

# Check the Pi's Tailscale IP.
tailscale ip

# Check CloudPi containers.
cd /home/pi/cloudpi
docker compose ps

# Check if ports 80 and 443 are listening on the Pi.
sudo ss -tulpn | grep -E ':80|:443'
```

If another service is using ports `80` or `443`, stop that service or change CloudPi's port mapping.

### HTTPS Certificate Problem

```bash
# Store the Pi's Tailscale hostname.
TS_HOSTNAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"

# Confirm certificate files exist.
sudo ls -l "/etc/ssl/certs/${TS_HOSTNAME}.crt" "/etc/ssl/private/${TS_HOSTNAME}.key"

# Confirm Docker and Nginx configs reference the same hostname.
cd /home/pi/cloudpi
grep -n "$TS_HOSTNAME" docker-compose.yml deploy/docker-nginx.conf
```

Regenerate the certificate:

```bash
# Store the Pi's Tailscale hostname.
TS_HOSTNAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"

# Regenerate the Tailscale HTTPS certificate.
sudo tailscale cert \
  --cert-file "/etc/ssl/certs/${TS_HOSTNAME}.crt" \
  --key-file "/etc/ssl/private/${TS_HOSTNAME}.key" \
  "$TS_HOSTNAME"

# Restart only the Nginx container.
cd /home/pi/cloudpi
docker compose restart nginx
```

### Backend Is Not Healthy

```bash
# Show the last 150 backend log lines.
cd /home/pi/cloudpi
docker compose logs --tail=150 backend

# Confirm backend/.env exists.
test -f backend/.env && echo "backend/.env exists"

# Show safe environment values.
grep -E '^(NODE_ENV|PORT|CLOUDPI_ALLOWED_ORIGINS)=' backend/.env

# Confirm the encryption key length.
awk -F= '/^CLOUDPI_ENCRYPTION_KEY=/{ print length($2) " hex characters configured" }' backend/.env
```

Common causes:

- `backend/.env` is missing.
- `JWT_SECRET` is missing.
- `CLOUDPI_ENCRYPTION_KEY` is not 64 hex characters.
- Docker was built before the project files were fully copied.
- Certificate path in `docker-compose.yml` does not match your real Tailscale hostname.
- A leftover root `.env` has old or wrong volume paths.

### Docker Permission Error

If Docker says permission denied:

```bash
# Add pi to the docker group again.
sudo usermod -aG docker pi

# Reboot so group membership applies.
sudo reboot
```

### USB Drive Not Showing In Admin

```bash
# Show detected disks and mount points.
lsblk -o NAME,PATH,FSTYPE,SIZE,MOUNTPOINTS,MODEL

# Check CloudPi USB mount points.
mount | grep /media/pi

# Watch USB event logs.
journalctl -t cloudpi-udev -f

# Restart CloudPi after changing backend/.env.
cd /home/pi/cloudpi
docker compose up -d
```

Common causes:

- USB automount script was not run.
- The drive has no filesystem.
- The drive is not USB-backed.
- `CLOUDPI_UDEV_SECRET` in `backend/.env` does not match `/etc/cloudpi/udev-secret`.
- The drive is mounted outside `/media/pi`.

### Video Thumbnails Do Not Generate

CloudPi uses `ffmpeg-static` inside the backend container for video thumbnails.

```bash
# Rebuild backend dependencies for the Pi architecture.
cd /home/pi/cloudpi
docker compose build --no-cache backend

# Restart the stack after rebuilding.
docker compose up -d
```

## 18. Final Acceptance Checklist

CloudPi setup is complete when:

- `docker compose ps` shows `cloudpi-backend` healthy.
- `docker compose ps` shows `cloudpi-nginx` running.
- `curl -k "https://${TS_HOSTNAME}/api/test"` returns backend JSON.
- The browser opens `https://<your-pi-name>.<your-tailnet>.ts.net`.
- First admin account can be created.
- Login works.
- Settings page loads.
- File Encryption card loads.
- A small file can be uploaded.
- The uploaded file can be previewed or downloaded.
- Optional: Admin Storage Manager can scan and label a USB drive.
