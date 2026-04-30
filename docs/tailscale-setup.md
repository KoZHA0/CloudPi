# Tailscale VPN Setup for CloudPi

Tailscale creates a secure, encrypted tunnel between your devices — allowing you to access CloudPi from anywhere without exposing your Raspberry Pi to the public internet.

## How It Works

```
┌─────────────┐     Tailscale VPN Tunnel     ┌──────────────┐
│ Your Phone/ │ ──────────────────────────── │ Raspberry Pi │
│ PC anywhere │   (encrypted, end-to-end)    │  (CloudPi)   │
└─────────────┘                              └──────────────┘
```

- All traffic between your devices and the Pi is encrypted
- No port forwarding needed on your router
- No public IP address exposed
- Free for personal use (up to 100 devices)

## Prerequisites

- A Tailscale account (free): https://tailscale.com
- Raspberry Pi with internet access
- Tailscale app installed on your phone/PC (the devices you'll access CloudPi from)

## Step 1: Install Tailscale on the Raspberry Pi

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

## Step 2: Connect to Your Tailnet

```bash
sudo tailscale up
```

This will print a URL — open it in a browser to authenticate with your Tailscale account.

After authenticating, verify the connection:
```bash
tailscale status
```

You should see your Pi listed with a Tailscale IP (e.g., `100.x.y.z`).

## Step 3: Find Your Tailscale Hostname

```bash
tailscale status --self
```

Your hostname will look like: `raspberrypi.your-tailnet.ts.net`

## Step 4: Enable HTTPS Certificates

Tailscale can automatically provision TLS certificates for your device:

```bash
# Generate certificates
sudo tailscale cert raspberrypi.your-tailnet.ts.net
```

This creates:
- `/etc/ssl/certs/raspberrypi.your-tailnet.ts.net.crt` (certificate)
- `/etc/ssl/private/raspberrypi.your-tailnet.ts.net.key` (private key)

## Step 5: Configure Nginx for HTTPS

1. Copy the SSL Nginx config:
   ```bash
   sudo cp /path/to/CloudPi/nginx/cloudpi-ssl.conf /etc/nginx/sites-available/cloudpi
   ```

2. Replace `YOUR_TAILSCALE_HOSTNAME` with your actual hostname:
   ```bash
   sudo sed -i 's/YOUR_TAILSCALE_HOSTNAME/raspberrypi.your-tailnet.ts.net/g' /etc/nginx/sites-available/cloudpi
   ```

3. Enable and reload:
   ```bash
   sudo ln -sf /etc/nginx/sites-available/cloudpi /etc/nginx/sites-enabled/cloudpi
   sudo nginx -t
   sudo systemctl reload nginx
   ```

## Step 6: Access CloudPi Securely

From any device on your Tailnet, open:
```
https://raspberrypi.your-tailnet.ts.net
```

You'll have full HTTPS encryption end-to-end.

## Step 7: Install Tailscale on Your Other Devices

- **Phone**: Install the Tailscale app from App Store / Google Play
- **PC**: Download from https://tailscale.com/download
- **Login** with the same account you used on the Pi

All your devices will automatically be able to reach the Pi.

## Certificate Renewal

Tailscale certificates expire after 90 days. Set up auto-renewal:

```bash
# Add to crontab
sudo crontab -e

# Add this line (renews monthly at 3 AM):
0 3 1 * * tailscale cert raspberrypi.your-tailnet.ts.net && systemctl reload nginx
```

## Troubleshooting

### "Cannot reach Pi"
- Verify Tailscale is running: `sudo systemctl status tailscaled`
- Check both devices are on the same Tailnet: `tailscale status`

### "Certificate error"
- Regenerate certs: `sudo tailscale cert <hostname>`
- Reload Nginx: `sudo systemctl reload nginx`

### "Tailscale not starting"
```bash
sudo systemctl enable tailscaled
sudo systemctl start tailscaled
sudo tailscale up
```
