# CloudPi Raspberry Pi Setup Guide - Explained Until Download

This guide starts from a blank Raspberry Pi and stops after the CloudPi project
has been downloaded to the Pi.

It does **not** continue into backend environment setup, Docker Compose
configuration, storage setup, or starting CloudPi.

The goal of this version is to explain every tool and every command so you know
what each step is doing, not just what to paste into the terminal.

## What This Guide Covers

By the end of this guide:

- Raspberry Pi OS Lite 64-bit is installed.
- SSH access works.
- The operating system is updated.
- Base command-line tools are installed.
- Docker and Docker Compose are installed.
- Tailscale is installed and logged in.
- Tailscale HTTPS certificates are generated.
- CloudPi is downloaded to `/home/pi/cloudpi`.

## Tools Used

### Raspberry Pi Imager

Raspberry Pi Imager is the official tool used to write Raspberry Pi OS onto a
microSD card or SSD. It also lets you set the hostname, username, password,
Wi-Fi, locale, and SSH before the Pi boots for the first time.

### Raspberry Pi OS Lite 64-bit

Raspberry Pi OS Lite is the server-style version of Raspberry Pi OS. It does not
include a desktop environment, which makes it lighter and better for a server.

This guide expects the **64-bit** version because Docker's normal Debian
`arm64` packages work cleanly with it.

### SSH

SSH means Secure Shell. It lets you open a terminal on the Raspberry Pi from
another computer over the network.

### apt

`apt` is the package manager used by Raspberry Pi OS and Debian. It installs,
updates, and removes system packages.

### dpkg

`dpkg` is the lower-level Debian package tool underneath `apt`. This guide uses
it to confirm the Pi is running the expected `arm64` architecture.

### sudo

`sudo` runs a command with administrator permissions. Many system setup commands
need `sudo` because they write to protected areas such as `/etc`.

### Git

Git downloads the CloudPi project from a Git repository and keeps the project
history.

### curl

`curl` downloads data from URLs. This guide uses it to download repository keys
and the Tailscale installer.

### ca-certificates

`ca-certificates` provides trusted certificate authority files. These let the Pi
verify HTTPS websites such as Docker's and Tailscale's download servers.

### GnuPG

`gnupg` provides cryptographic signing tools. Many package repositories use GPG
keys so `apt` can verify that downloaded package metadata is authentic.

### OpenSSL

`openssl` works with keys, certificates, and random secrets. It is installed now
because it is needed later in the full CloudPi setup.

### SQLite

`sqlite3` is the command-line tool for SQLite databases. CloudPi uses SQLite
later in the full setup.

### util-linux

`util-linux` is a collection of standard Linux system utilities. It provides
common low-level commands used by many setup and maintenance tasks.

### nano

`nano` is a simple terminal text editor. It is useful when you need to edit a
configuration file directly on the Pi.

### Docker Engine

Docker Engine runs containers. CloudPi uses containers so the Pi does not need
Node.js, Nginx, or other app dependencies installed directly on the host system.

### Docker Compose Plugin

Docker Compose starts several related containers together from a
`docker-compose.yml` file. CloudPi uses Compose later in the full setup.

### Tailscale

Tailscale creates a private network between your devices. It gives the Pi a
private `.ts.net` name and lets your trusted devices reach CloudPi securely.

### Tailscale HTTPS Certificates

Tailscale can issue HTTPS certificates for your Pi's `.ts.net` hostname. These
certificates are used later by Nginx when CloudPi runs over HTTPS.

### jq

`jq` reads and extracts values from JSON. This guide uses it to pull the Pi's
Tailscale DNS name from `tailscale status --json`.

### sed

`sed` edits text streams. This guide uses it to remove the trailing dot from the
Tailscale DNS name.

## Names Used In This Guide

```text
Pi username:      pi
Pi hostname:      cloudpi
Project path:     /home/pi/cloudpi
Web hostname:     <your-pi-name>.<your-tailnet>.ts.net
```

Replace placeholders like `<your-repo-url>` and
`<your-pi-name>.<your-tailnet>.ts.net` with your real values.

## 1. Flash Raspberry Pi OS

Do this on your main computer, not on the Raspberry Pi.

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

Wait 2-5 minutes for the first boot.

### Why This Step Matters

The operating system is the base layer for everything else. Setting SSH,
hostname, username, and Wi-Fi in Raspberry Pi Imager saves time because the Pi
can boot directly into a remote-ready server setup.

### Important Choices

- **Hostname `cloudpi`**: lets you connect with `cloudpi.local` on many home
  networks.
- **Username `pi`**: this guide assumes the user is named `pi`.
- **SSH enabled**: required so you can run commands on the Pi from another
  computer.
- **64-bit OS**: required for the Docker path used in this guide.

## 2. Connect To The Pi

Run this command from your main computer terminal:

```bash
ssh pi@cloudpi.local
```

### Command Explanation

`ssh` starts a secure terminal connection to another machine.

`pi@cloudpi.local` tells SSH to log in as the user `pi` on the device named
`cloudpi.local`.

The full command means: "Open a secure terminal session as user `pi` on the
Raspberry Pi named `cloudpi`."

If `cloudpi.local` does not work, find the Pi IP address from your router and
run this instead:

```bash
ssh pi@<pi-ip-address>
```

### Command Explanation

`<pi-ip-address>` is a placeholder. Replace it with the real IP address of your
Pi, for example:

```bash
ssh pi@192.168.1.25
```

This does the same thing as `ssh pi@cloudpi.local`, but it uses the numeric
network address instead of the local hostname.

## 3. Update The Operating System

Run these commands on the Pi after logging in with SSH:

```bash
sudo apt update
```

### Command Explanation

`sudo` runs the command with administrator permissions.

`apt` is the system package manager.

`update` refreshes the package list from the configured software repositories.

This command does not install upgrades by itself. It only updates the Pi's
knowledge of which package versions are available.

```bash
sudo apt full-upgrade -y
```

### Command Explanation

`sudo` gives administrator permissions.

`apt full-upgrade` installs all available operating system updates. It is more
complete than a basic upgrade because it can also install or remove packages
when needed to complete the upgrade safely.

`-y` automatically answers yes to confirmation prompts.

This command brings the Pi up to date before installing Docker, Tailscale, and
CloudPi dependencies.

```bash
sudo apt install -y git curl ca-certificates gnupg jq openssl sqlite3 util-linux nano
```

### Command Explanation

`sudo apt install` installs packages from the Raspberry Pi OS repositories.

`-y` automatically confirms the install.

`git` downloads the CloudPi project from a Git repository.

`curl` downloads files and scripts from HTTPS URLs.

`ca-certificates` lets the Pi verify HTTPS certificates when connecting to
secure websites.

`gnupg` provides GPG tools used by many software repositories for package
signing and verification.

`jq` reads JSON data in shell commands.

`openssl` creates and inspects cryptographic keys, certificates, and random
secrets.

`sqlite3` is the command-line tool for SQLite databases. CloudPi uses SQLite
later in the full setup.

`util-linux` contains useful Linux system utilities.

`nano` is a beginner-friendly terminal text editor.

```bash
sudo reboot
```

### Command Explanation

`sudo` gives administrator permissions.

`reboot` restarts the Raspberry Pi.

Restarting after a full operating system upgrade makes sure the Pi is using the
newest kernel, services, and system libraries.

After the Pi comes back online, reconnect from your main computer:

```bash
ssh pi@cloudpi.local
```

### Command Explanation

This opens a new SSH session because the previous one closed when the Pi
rebooted.

## 4. Install Docker And Docker Compose

Docker runs CloudPi in containers. Docker Compose is installed now because the
full CloudPi stack is started with a `docker-compose.yml` file later.

This guide expects **Raspberry Pi OS Lite 64-bit**. If Docker packages show
`no installation candidate`, confirm the Pi is really using the 64-bit `arm64`
OS and that Docker's apt repository was added correctly.

```bash
sudo apt update
```

### Command Explanation

This refreshes package metadata before adding Docker's repository. It is a good
habit before installing packages because it avoids using stale package lists.

```bash
sudo apt install -y ca-certificates curl
```

### Command Explanation

This makes sure the Pi has the tools needed to securely download Docker's
repository signing key.

`ca-certificates` lets HTTPS certificate validation work.

`curl` downloads the Docker signing key from Docker's website.

```bash
dpkg --print-architecture
```

### Command Explanation

`dpkg` is the lower-level Debian package tool underneath `apt`.

`--print-architecture` prints the CPU/software architecture used by the
installed operating system.

For this guide, the output should be:

```text
arm64
```

If the output is not `arm64`, you are probably not running the 64-bit Raspberry
Pi OS image expected by this guide.

```bash
. /etc/os-release && echo "$VERSION_CODENAME"
```

### Command Explanation

`. /etc/os-release` loads operating system information into the current shell.
The leading dot is a shell command that means "source this file."

`&&` means "only run the next command if the previous command worked."

`echo "$VERSION_CODENAME"` prints the Debian/Raspberry Pi OS codename, such as
`bookworm`.

Docker's repository uses this codename to choose the correct package set.

```bash
sudo install -m 0755 -d /etc/apt/keyrings
```

### Command Explanation

`sudo` is needed because `/etc/apt` is a protected system directory.

`install` can create directories with specific permissions.

`-m 0755` sets the directory permissions. The owner can read, write, and enter
the directory. Everyone else can read and enter it.

`-d` tells `install` to create a directory.

`/etc/apt/keyrings` is where apt repository signing keys are stored.

```bash
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
```

### Command Explanation

`sudo` lets the command write into `/etc/apt/keyrings`.

`curl` downloads Docker's GPG signing key.

`-f` makes curl fail on HTTP errors instead of saving an error page.

`-s` makes curl quiet.

`-S` still shows an error message if the download fails.

`-L` follows redirects.

`https://download.docker.com/linux/debian/gpg` is Docker's Debian repository
signing key.

`-o /etc/apt/keyrings/docker.asc` saves the downloaded key to that file.

apt uses this key to verify that Docker packages really came from Docker.

```bash
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

### Command Explanation

`chmod` changes file permissions.

`a+r` means "allow all users to read this file."

apt needs to be able to read Docker's signing key when checking package
metadata.

```bash
sudo rm -f /etc/apt/sources.list.d/docker.list /etc/apt/sources.list.d/docker.sources
```

### Command Explanation

`rm` removes files.

`-f` means "force." It prevents an error if the file does not exist.

The two paths are possible old Docker repository source files.

Removing them first avoids duplicate or stale Docker repository definitions.

```bash
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
```

### Command Explanation

This writes Docker's apt repository configuration file.

`sudo tee /etc/apt/sources.list.d/docker.sources` writes text into the protected
apt sources directory.

`tee` is used because normal shell redirection with `sudo` can be tricky. The
`tee` command itself runs with administrator permissions and writes the file.

`> /dev/null` hides the copy of the text that `tee` would normally print back to
the terminal.

`<<EOF` starts a heredoc. A heredoc sends the following lines as input until the
closing `EOF`.

`Types: deb` says this repository contains Debian package files.

`URIs: https://download.docker.com/linux/debian` points apt to Docker's Debian
package repository.

`Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")` inserts the OS
codename, such as `bookworm`.

`Components: stable` uses Docker's stable release channel.

`Architectures: $(dpkg --print-architecture)` inserts the Pi's architecture,
which should be `arm64`.

`Signed-By: /etc/apt/keyrings/docker.asc` tells apt which signing key should be
trusted for this repository.

```bash
sudo apt update
```

### Command Explanation

This refreshes package metadata again. This time apt also reads Docker's newly
added repository, so Docker packages become available for installation.

```bash
apt-cache policy docker-ce
```

### Command Explanation

`apt-cache policy` shows where a package would come from and which version apt
would install.

`docker-ce` is Docker Community Edition.

If this command shows `Candidate: (none)`, apt still cannot see Docker's
package. Do not run the install command until that is fixed.

```bash
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### Command Explanation

This installs Docker's main packages.

`docker-ce` is Docker Engine.

`docker-ce-cli` is the `docker` command-line client.

`containerd.io` is the container runtime used by Docker.

`docker-buildx-plugin` adds modern Docker image build features.

`docker-compose-plugin` adds the `docker compose` command.

`-y` confirms the install automatically.

```bash
sudo usermod -aG docker pi
```

### Command Explanation

`usermod` changes a Linux user account.

`-aG docker` means "append this user to the docker group."

`pi` is the username being changed.

After this, the `pi` user can run Docker commands without typing `sudo` every
time.

```bash
sudo reboot
```

### Command Explanation

This restarts the Pi so the new Docker group membership applies to the `pi`
user's next login session.

Reconnect after the reboot:

```bash
ssh pi@cloudpi.local
```

### Command Explanation

This opens a fresh SSH session after reboot. The new session should include the
updated Docker group permissions.

### Docker Verification

Run these commands after reconnecting:

```bash
docker --version
```

This prints the installed Docker version. It confirms the `docker` command is
available.

```bash
docker compose version
```

This prints the installed Docker Compose plugin version. It confirms the
`docker compose` command is available.

```bash
docker run --rm hello-world
```

This downloads and runs Docker's small test container.

`docker run` starts a container.

`--rm` removes the container after it exits, keeping the system clean.

`hello-world` is Docker's official test image.

If this works, Docker is installed correctly.

## 5. Install And Login To Tailscale

Tailscale lets you access the Pi privately from your own devices, even when you
are not on the same local network.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
```

### Command Explanation

`curl` downloads Tailscale's official install script.

`-f` fails on HTTP errors.

`-s` keeps output quiet.

`-S` shows an error if something fails.

`-L` follows redirects.

`https://tailscale.com/install.sh` is the installer script URL.

`|` is a pipe. It sends the downloaded script into the next command.

`sh` runs the script with the system shell.

The result is that Tailscale's package repository is added and Tailscale is
installed.

```bash
sudo tailscale up
```

### Command Explanation

`sudo` gives administrator permissions because Tailscale configures networking.

`tailscale up` starts Tailscale and begins login for this Pi.

The command prints a login URL. Open that URL in your browser and approve the
Pi in your Tailscale account.

### Recommended Tailscale Admin Settings

In the Tailscale admin console:

- Enable **MagicDNS** so the Pi gets a friendly `.ts.net` DNS name.
- Enable **HTTPS certificates** so Tailscale can issue certificates.
- Consider disabling key expiry for this Pi if it will be a long-running server.

```bash
tailscale status
```

### Command Explanation

This shows the devices in your tailnet and whether this Pi is connected.

The tailnet is your private Tailscale network.

```bash
tailscale ip
```

### Command Explanation

This prints the Pi's Tailscale IP addresses.

You may see an IPv4 address, an IPv6 address, or both.

```bash
tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//'
```

### Command Explanation

This command finds the Pi's full Tailscale DNS name.

`tailscale status --json` prints Tailscale status as JSON.

`|` sends that JSON into the next command.

`jq -r '.Self.DNSName'` extracts the Pi's own DNS name from the JSON.

`-r` means raw output, so `jq` prints plain text instead of quoted JSON text.

The second `|` sends that DNS name into `sed`.

`sed 's/\.$//'` removes a trailing dot from the DNS name.

The final output should look similar to:

```text
cloudpi.tail00000.ts.net
```

```bash
TS_HOSTNAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
```

### Command Explanation

This stores the Pi's Tailscale hostname in a shell variable named
`TS_HOSTNAME`.

`TS_HOSTNAME=...` creates the variable.

`$(...)` runs the command inside the parentheses and substitutes its output.

The command inside is the same hostname lookup explained above.

This variable is useful because later commands can reuse the hostname without
typing it manually.

```bash
echo "$TS_HOSTNAME"
```

### Command Explanation

`echo` prints text.

`"$TS_HOSTNAME"` prints the value stored in the `TS_HOSTNAME` variable.

The quotes are good practice because they keep the value together if it ever
contains special characters or spaces.

Example output:

```text
cloudpi.tail00000.ts.net
```

## 6. Generate Tailscale HTTPS Certificates

CloudPi's Nginx container expects HTTPS certificate files on the Pi host later
in the full setup.

```bash
TS_HOSTNAME="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"
```

### Command Explanation

This stores the Pi's Tailscale hostname again.

Shell variables only last for the current terminal session. Running this again
makes sure `TS_HOSTNAME` exists before generating certificates.

```bash
sudo tailscale cert \
  --cert-file "/etc/ssl/certs/${TS_HOSTNAME}.crt" \
  --key-file "/etc/ssl/private/${TS_HOSTNAME}.key" \
  "$TS_HOSTNAME"
```

### Command Explanation

This asks Tailscale to create an HTTPS certificate and private key for the Pi's
Tailscale hostname.

`sudo` is needed because the command writes to protected certificate
directories under `/etc/ssl`.

`tailscale cert` requests a certificate from Tailscale.

`\` at the end of a line means the command continues on the next line.

`--cert-file "/etc/ssl/certs/${TS_HOSTNAME}.crt"` chooses where to save the
public certificate file.

`${TS_HOSTNAME}` inserts the value of the `TS_HOSTNAME` variable into the file
name.

`--key-file "/etc/ssl/private/${TS_HOSTNAME}.key"` chooses where to save the
private key file.

`"$TS_HOSTNAME"` tells Tailscale which hostname the certificate should be valid
for.

```bash
sudo chmod 600 "/etc/ssl/private/${TS_HOSTNAME}.key"
```

### Command Explanation

This locks down the private key file.

`chmod 600` means only the file owner can read and write the file. No other user
can read it.

Private keys should be protected because they prove the server's identity.

```bash
sudo chmod 644 "/etc/ssl/certs/${TS_HOSTNAME}.crt"
```

### Command Explanation

This makes the public certificate readable by services.

`chmod 644` means the owner can read and write the file, and everyone else can
read it.

The certificate is public information, so it does not need to be locked down
like the private key.

```bash
sudo ls -l "/etc/ssl/certs/${TS_HOSTNAME}.crt" "/etc/ssl/private/${TS_HOSTNAME}.key"
```

### Command Explanation

`ls` lists files.

`-l` shows detailed file information, including permissions, owner, size, and
modified time.

`sudo` is used because one of the files is inside `/etc/ssl/private`, which is a
restricted directory.

This confirms both certificate files exist.

## 7. Download CloudPi

This section downloads the CloudPi project onto the Raspberry Pi.

Use Git if your project is stored in a Git repository.

```bash
cd /home/pi
```

### Command Explanation

`cd` means change directory.

`/home/pi` is the home directory for the `pi` user.

Running the download from `/home/pi` keeps the project in a predictable place.

```bash
git clone <your-repo-url> cloudpi
```

### Command Explanation

`git clone` downloads a copy of a Git repository.

`<your-repo-url>` is a placeholder. Replace it with the real CloudPi repository
URL.

`cloudpi` is the folder name Git should create.

The full command downloads the project into:

```text
/home/pi/cloudpi
```

Example:

```bash
git clone https://github.com/your-name/cloudpi.git cloudpi
```

```bash
cd /home/pi/cloudpi
```

### Command Explanation

This enters the downloaded CloudPi project directory.

After this command, your terminal is working inside the CloudPi project folder.

If you copied the project another way, make sure it still ends up here:

```bash
cd /home/pi/cloudpi
```

### Command Explanation

This verifies that the expected CloudPi project folder exists and that you can
enter it.

```bash
ls docker-compose.yml Dockerfile backend/server.js frontend/package.json deploy/docker-nginx.conf
```

### Command Explanation

`ls` lists files.

This command checks for the important CloudPi files expected by the rest of the
full setup.

`docker-compose.yml` defines the CloudPi container stack.

`Dockerfile` defines how the CloudPi app image is built.

`backend/server.js` is the backend server entry point.

`frontend/package.json` defines frontend dependencies and scripts.

`deploy/docker-nginx.conf` is the Nginx configuration used by the Docker setup.

If all paths are printed without errors, CloudPi has been downloaded into the
expected location.

## Stop Here

This guide intentionally stops here.

At this point, the Raspberry Pi is prepared and the CloudPi project should exist
at:

```text
/home/pi/cloudpi
```

The next steps in the full setup would be creating environment files, updating
the Tailscale hostname in Docker and Nginx config, choosing storage, validating
Docker Compose, and starting CloudPi.
