#!/usr/bin/env sh
set -eu

/opt/momo-result/bin/render-nginx-conf
nginx -t -c /etc/nginx/nginx.conf
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/momo-result.conf
