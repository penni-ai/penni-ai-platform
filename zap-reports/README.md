# ZAP Baseline Reports

This folder contains OWASP ZAP baseline scan outputs captured against `https://penni-ai.com/`.

Files:
- `zap_baseline*.html/.json/.xml`: ZAP baseline reports
- `zap.yaml`: ZAP automation config used by the container
- `penni-ai-edge-proxy-startup-v*.sh`: Nginx edge proxy startup scripts used to harden headers/methods

Re-run (requires Docker Desktop):
- `docker run --rm -t -u zap -v "$PWD/zap-reports:/zap/wrk:rw" zaproxy/zap-stable:latest zap-baseline.py -t https://penni-ai.com/ -r zap_baseline.html -J zap_baseline.json -x zap_baseline.xml -m 5 -a`

