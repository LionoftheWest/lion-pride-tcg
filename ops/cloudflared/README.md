# Cloudflare tunnel for the Discord Activity

## Why

On 2026-10-13 from about 14:50 UTC, the Discord Activity proxy (Cloudflare) returned
Error 1016 "Origin DNS error" for every hostname that points to our Oracle VMs
(`lionpridetcg.duckdns.org`, an `sslip.io` name, and the backup VM). Public DNS was
correct, and the same proxy reached `httpbin.org` and Supabase. The Activity showed a
white frame for about 3 hours. The cause is not known.

A named tunnel puts the origin on Cloudflare, so the proxy does not resolve an Oracle IP.

## What runs

- Domain `lionpridetcg.com` (Cloudflare Registrar, Nathan's personal account).
- DNS: `play.lionpridetcg.com` is a CNAME to tunnel `lionpride-main`.
- Main VM: container `cf-named` runs the tunnel with `config.yml` (this folder has a copy).
  The tunnel sends requests to Caddy on `:443` with the host `lionpridetcg.duckdns.org`,
  so every Caddy rule (`/app`, `/cimg`, the log filter) still applies.
- Discord Developer Portal, Activities, URL Mappings: root `/` to `play.lionpridetcg.com/app`.

`/home/ubuntu/cloudflared/` (owner 65532, mode 700) holds `cert.pem` and the tunnel
credentials. Never commit them.

## Start or restart

```sh
sudo docker run -d --name cf-named --network host --restart unless-stopped \
  --log-opt max-size=10m -v /home/ubuntu/cloudflared:/home/nonroot/.cloudflared \
  cloudflare/cloudflared:latest tunnel --no-autoupdate \
  --config /home/nonroot/.cloudflared/config.yml run
```

Check: `sudo docker logs cf-named | grep "Registered tunnel connection"` (4 lines), then
`curl https://play.lionpridetcg.com/app/api/config`.

## Check the Discord proxy

`curl https://1546979011140395098.discordsays.com/api/config` must return the config JSON.
A Cloudflare error page has the cause in its `<title>`.

## Limit

The backup VM failover changes only the DuckDNS record. It does not move this tunnel.
