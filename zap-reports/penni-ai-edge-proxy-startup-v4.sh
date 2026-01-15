#!/bin/bash
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends nginx-extras ca-certificates

mkdir -p /var/www/penni-static
cat > /var/www/penni-static/sitemap.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://penni-ai.com/</loc></url>
  <url><loc>https://penni-ai.com/sign-in</loc></url>
  <url><loc>https://penni-ai.com/sign-up</loc></url>
  <url><loc>https://penni-ai.com/privacy</loc></url>
  <url><loc>https://penni-ai.com/terms</loc></url>
</urlset>
XML

mkdir -p /var/cache/nginx/penni
chown -R www-data:www-data /var/cache/nginx

cat > /etc/nginx/conf.d/penni-cache.conf <<'NGINX'
# Shared proxy cache (http{} context)
proxy_cache_path /var/cache/nginx/penni levels=1:2 keys_zone=penni_cache:10m max_size=100m inactive=24h use_temp_path=off;
NGINX

cat > /etc/nginx/sites-available/default <<'NGINX'
server {
	listen 8080 default_server;
	server_name _;

	server_tokens off;

	# Strip upstream/proxy fingerprint headers (best-effort; some may be added by the LB).
	more_clear_headers Server;
	more_clear_headers Via;
	more_clear_headers X-Powered-By;
	more_clear_headers Age;

	# Ensure single, consistent security headers (avoids duplicates from upstream).
	more_set_headers "X-Frame-Options: DENY";
	more_set_headers "X-Content-Type-Options: nosniff";
	more_set_headers "Referrer-Policy: strict-origin-when-cross-origin";
	more_set_headers "Strict-Transport-Security: max-age=31536000; includeSubDomains";

	# Extra hardening (helps ZAP/CASA).
	more_set_headers "Content-Security-Policy: default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; img-src 'self' data: https:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: wss:; font-src 'self' data: https:; upgrade-insecure-requests";
	more_set_headers "Permissions-Policy: accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()";
	more_set_headers "Cross-Origin-Opener-Policy: same-origin";
	more_set_headers "Cross-Origin-Embedder-Policy: credentialless";
	more_set_headers "Cross-Origin-Resource-Policy: same-origin";

	# Health check
	location = /healthz {
		add_header Content-Type text/plain;
		return 200 "ok\n";
	}

	# Block risky methods explicitly
	if ($request_method ~* "^(TRACE|TRACK|OPTIONS)$") {
		return 405;
	}

	# Cache policy:
	# - HTML pages are cacheable but revalidated (no sensitive/user-specific content).
	# - Auth-related pages are not cached.
	# - Immutable build assets are cached aggressively.
	# - robots/sitemap are cached briefly and are UA-stable.

	location ~* ^/(sign-in|sign-up|forgot-password)(/)?$ {
		more_set_headers "Cache-Control: private, max-age=0, must-revalidate";
		more_set_headers "Vary: Accept-Encoding";
		include /etc/nginx/snippets/penni-proxy-common.conf;
		proxy_pass https://35.219.200.8;
	}

	location ~* ^/_app/immutable/ {
		more_set_headers "Cache-Control: public, max-age=31536000, immutable";
		more_set_headers "Vary: Accept-Encoding";
		include /etc/nginx/snippets/penni-proxy-common.conf;
		proxy_pass https://35.219.200.8;
	}

	location = /robots.txt {
		more_set_headers "Cache-Control: public, max-age=3600";
		more_set_headers "Vary: Accept-Encoding";
		include /etc/nginx/snippets/penni-proxy-common.conf;
		proxy_pass https://35.219.200.8;
	}

	location = /sitemap.xml {
		more_set_headers "Cache-Control: public, max-age=3600";
		more_set_headers "Vary: Accept-Encoding";
		alias /var/www/penni-static/sitemap.xml;
	}

	location / {
		more_set_headers "Cache-Control: private, max-age=0, must-revalidate";
		more_set_headers "Vary: Accept-Encoding";
		include /etc/nginx/snippets/penni-proxy-common.conf;
		proxy_pass https://35.219.200.8;
	}
}
NGINX

mkdir -p /etc/nginx/snippets
cat > /etc/nginx/snippets/penni-proxy-common.conf <<'NGINX'
proxy_http_version 1.1;
proxy_set_header Host penni-ai.com;
proxy_set_header Connection "";
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Forwarded-Host $host;

proxy_ssl_server_name on;
proxy_ssl_name penni-ai.com;
proxy_ssl_verify on;
proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;

# Hide upstream-set headers; we set final values ourselves.
proxy_hide_header Server;
proxy_hide_header Via;
proxy_hide_header X-Powered-By;
proxy_hide_header Age;
proxy_hide_header Cache-Control;
proxy_hide_header Pragma;
proxy_hide_header Expires;
proxy_hide_header Vary;
proxy_hide_header X-Frame-Options;
proxy_hide_header X-Content-Type-Options;
proxy_hide_header Referrer-Policy;
proxy_hide_header Strict-Transport-Security;
proxy_hide_header Content-Security-Policy;
proxy_hide_header Permissions-Policy;
proxy_hide_header Cross-Origin-Opener-Policy;
proxy_hide_header Cross-Origin-Embedder-Policy;
proxy_hide_header Cross-Origin-Resource-Policy;
NGINX

nginx -t
systemctl restart nginx
