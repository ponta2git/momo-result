#!/usr/bin/env sh
set -eu

nginx_conf="${MOMO_NGINX_OUTPUT_PATH:-/etc/nginx/nginx.conf}"

for runtime_dir in \
  "${IMAGE_TMP_DIR:-/tmp/momo-result/uploads}" \
  /tmp/momo-result/nginx/client_body \
  /tmp/momo-result/nginx/fastcgi \
  /tmp/momo-result/nginx/proxy \
  /tmp/momo-result/nginx/scgi \
  /tmp/momo-result/nginx/uwsgi
do
  mkdir -p "${runtime_dir}"
done

/opt/momo-result/bin/render-nginx-conf
nginx -t -c "${nginx_conf}"
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/momo-result.conf
