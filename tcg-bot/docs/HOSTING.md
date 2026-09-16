# Hosting

The bot runs 24/7 on an Oracle Cloud **Always Free** VM, independent of any
workstation. Data (collections, card art) lives in Supabase, so the VM is
disposable — collections survive restarts, redeploys, and rebuilds.

## The VM

- Provider: Oracle Cloud, Always Free `VM.Standard.E2.1.Micro` (x86_64, 1 GB + 2 GB swap).
- OS: Ubuntu 24.04. User: `ubuntu`. Public IP: `137.131.48.8`.
- The bot runs as a Docker container named `tcg-bot` with `--restart unless-stopped`,
  and Docker is enabled at boot — so it survives crashes and VM reboots.
- The 5 secrets live in `/home/ubuntu/tcg-bot/.env` on the VM (never in git).

## Provision a fresh VM

```sh
scp -i <key> deploy/setup-vm.sh ubuntu@<ip>:/home/ubuntu/
ssh -i <key> ubuntu@<ip> "bash setup-vm.sh"   # swap + Docker
```

## Deploy / update the bot

From the project root, copy the code and secrets, then build and run:

```sh
ssh -i <key> ubuntu@<ip> "mkdir -p /home/ubuntu/tcg-bot"
scp -i <key> package.json package-lock.json tsconfig.json Dockerfile .env ubuntu@<ip>:/home/ubuntu/tcg-bot/
scp -i <key> -r src ubuntu@<ip>:/home/ubuntu/tcg-bot/
scp -i <key> deploy/run-bot.sh ubuntu@<ip>:/home/ubuntu/
ssh -i <key> ubuntu@<ip> "bash run-bot.sh"    # build image + (re)start container
```

**Only one instance may run per bot token.** Do not run the local dev bot at the
same time as the VM — two gateway connections cause duplicate responses.

## Operate

```sh
ssh -i <key> ubuntu@<ip> "sudo docker logs --tail 30 tcg-bot"   # view logs
ssh -i <key> ubuntu@<ip> "sudo docker restart tcg-bot"          # restart
ssh -i <key> ubuntu@<ip> "sudo docker ps"                       # status
```
