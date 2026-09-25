# Hosting

The bot runs 24/7 on an Oracle Cloud **Always Free** VM, independent of any
workstation. Data (collections, card art) lives in Supabase, so the VM is
disposable — collections survive restarts, redeploys, and rebuilds.

## The VM

- Provider: Oracle Cloud, Always Free `VM.Standard.E2.1.Micro` (x86_64, 1 GB + 2 GB swap).
- OS: Ubuntu 24.04. User: `ubuntu`. Public IP: resolve `lionpridetcg.duckdns.org` first. The stack moved to an Oracle Ampere A1 box (`129.146.118.111`, 2026-09-21). See `ops/migrate-to-a1.sh`.
- The bot runs as a Docker container named `tcg-bot` with `--restart unless-stopped`,
  and Docker is enabled at boot — so it survives crashes and VM reboots.
- The 5 secrets live in `/home/ubuntu/tcg-bot/.env` on the VM (never in git).

## Provision a fresh VM

```sh
scp -i <key> deploy/setup-vm.sh ubuntu@<ip>:/home/ubuntu/
ssh -i <key> ubuntu@<ip> "bash setup-vm.sh"   # swap + Docker
```

## Deploy / update the bot

From a worktree at `origin/main`, with the change committed and pushed:

```sh
ops/deploy.sh bot
```

The script ships only `src`, the package files, `tsconfig.json`, and the `Dockerfile`.
It keeps the VM `.env`, runs the container with `--network host` (the Activity calls
the internal API at `127.0.0.1:4451`), waits for `Ready. Logged in`, rolls back on a
failure, and registers the slash commands.

**Only one instance may run per bot token.** Do not run the local dev bot at the
same time as the VM — two gateway connections cause duplicate responses.

## Operate

```sh
ssh -i <key> ubuntu@<ip> "sudo docker logs --tail 30 tcg-bot"   # view logs
ssh -i <key> ubuntu@<ip> "sudo docker restart tcg-bot"          # restart
ssh -i <key> ubuntu@<ip> "sudo docker ps"                       # status
```
