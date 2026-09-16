#!/usr/bin/env bash
# Provision a fresh Ubuntu VM to run the bot: swap + Docker.
set -e

# A 2 GB swap file so the 1 GB box can build the image without OOM.
if ! sudo swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y
sudo apt-get install -y docker.io
sudo systemctl enable --now docker

sudo docker --version
echo "--- memory (with swap) ---"
free -m | head -3
echo "SETUP DONE"
