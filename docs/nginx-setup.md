# Nginx Reverse Proxy Setup for CloudPi

This guide explains how to set up Nginx as a reverse proxy in front of the CloudPi Express.js backend on your Raspberry Pi.

## Why Nginx?

- **Security**: Adds HTTP security headers, hides Express internals
- **Performance**: Handles static file caching and connection management
- **SSL/TLS**: Terminates HTTPS connections (with Tailscale certs)
- **Stability**: Buffers slow clients so Express isn't blocked

## Prerequisites

- Raspberry Pi running Raspberry Pi OS (Debian-based)
- CloudPi backend running on port 3001
- SSH access to the Pi

## Step 1: Install Nginx

```bash
sudo apt update
sudo apt install nginx -y
```

Verify it's running:
```bash
sudo systemctl status nginx
```

## Step 2: Copy the CloudPi Config

### HTTP Only (local network)

```bash
# Copy the config file
sudo cp /path/to/CloudPi/nginx/cloudpi.conf /etc/nginx/sites-available/cloudpi

# Remove the default site
sudo rm /etc/nginx/sites-enabled/default

# Enable CloudPi site
sudo ln -s /etc/nginx/sites-available/cloudpi /etc/nginx/sites-enabled/cloudpi
```

### HTTPS with Tailscale (remote access)

If you've set up Tailscale (see [tailscale-setup.md](./tailscale-setup.md)):

```bash
# Copy the SSL config instead
sudo cp /path/to/CloudPi/nginx/cloudpi-ssl.conf /etc/nginx/sites-available/cloudpi

# Edit the file to replace YOUR_TAILSCALE_HOSTNAME with your actual hostname
sudo nano /etc/nginx/sites-available/cloudpi

# Enable the site
sudo ln -s /etc/nginx/sites-available/cloudpi /etc/nginx/sites-enabled/cloudpi
```

## Step 3: Test and Reload

```bash
# Test configuration for syntax errors
sudo nginx -t

# If test passes, reload Nginx
sudo systemctl reload nginx
```

## Step 4: Verify

Open a browser and navigate to:
- **HTTP**: `http://<your-pi-ip>` (should show CloudPi)
- **HTTPS**: `https://<your-tailscale-hostname>` (if Tailscale is set up)

## Troubleshooting

### "502 Bad Gateway"
The Express backend isn't running. Start it:
```bash
cd /path/to/CloudPi/backend
node server.js
```

### "413 Request Entity Too Large"
The `client_max_body_size` in the Nginx config needs to match or exceed the Express upload limit. Default is `100M`.

### Check Nginx logs
```bash
sudo tail -f /var/log/nginx/cloudpi-error.log
```
