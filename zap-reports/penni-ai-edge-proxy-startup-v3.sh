#!/bin/bash
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y --no-install-recommends nginx-extras ca-certificates

cat > /etc/nginx/sites-available/default <<'NGINX'
server {
	listen 8080 default_server;
	server_name _;

	server_tokens off;

	# Strip upstream/proxy fingerprint headers.
	more_clear_headers Server;
	more_clear_headers Via;
	more_clear_headers X-Powered-By;

	# Ensure single, consistent security headers (avoids duplicates from upstream).
	more_set_headers "X-Frame-Options: DENY";
	more_set_headers "X-Content-Type-Options: nosniff";
	more_set_headers "Referrer-Policy: strict-origin-when-cross-origin";
	more_set_headers "Strict-Transport-Security: max-age=31536000; includeSubDomains";

	# Extra hardening (helps ZAP/CASA).
	more_set_headers "Content-Security-Policy: default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; form-action 'self'; img-src 'self' data: https:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https: wss:; font-src 'self' data: https:; upgrade-insecure-requests";
	more_set_headers "Permissions-Policy: accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()";
	more_set_headers "Cross-Origin-Opener-Policy: same-origin-allow-popups";
	more_set_headers "Cross-Origin-Embedder-Policy: credentialless";
	more_set_headers "Cross-Origin-Resource-Policy: same-site";

	# CASA cache findings: keep everything non-cacheable.
	more_set_headers "Cache-Control: no-store, max-age=0";
	more_set_headers "Pragma: no-cache";
	more_set_headers "Expires: 0";

	# Health check
	location = /healthz {
		add_header Content-Type text/plain;
		return 200 "ok\n";
	}

	# Block risky methods explicitly
	if ($request_method ~* "^(TRACE|TRACK|OPTIONS)$") {
		return 405;
	}

	location / {
		proxy_http_version 1.1;
		proxy_set_header Host penni-ai.com;
		proxy_set_header Connection "";
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
		proxy_set_header X-Forwarded-Host $host;

		proxy_ssl_server_name on;
		proxy_ssl_name penni-ai.com;
		proxy_ssl_verify on;
		proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;

		# Hide upstream-set headers (defense-in-depth; more_set_headers above sets final).
		proxy_hide_header Server;
		proxy_hide_header Via;
		proxy_hide_header X-Powered-By;
		proxy_hide_header X-Frame-Options;
		proxy_hide_header X-Content-Type-Options;
		proxy_hide_header Referrer-Policy;
		proxy_hide_header Strict-Transport-Security;
		proxy_hide_header Cache-Control;
		proxy_hide_header Pragma;
		proxy_hide_header Expires;

		proxy_pass https://35.219.200.8;
	}
}
NGINX

nginx -t
systemctl restart nginx
