# Shared helpers, prepended to every app recipe by the panel. Runs as root on the VPS via the agent.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
TOTAL_STEPS=1

step() { echo "##STEP $1/$TOTAL_STEPS $2"; }
die() { echo "error: $*" >&2; exit 1; }

detect_pm() {
  if command -v apt-get >/dev/null 2>&1; then PM=apt
  elif command -v dnf >/dev/null 2>&1; then PM=dnf
  elif command -v yum >/dev/null 2>&1; then PM=yum
  else die "unsupported system: no apt, dnf or yum found"; fi
}

pkg_install() {
  case "$PM" in
    apt) apt-get update -qq && apt-get install -y -qq "$@" ;;
    dnf) dnf install -y -q "$@" ;;
    yum) yum install -y -q "$@" ;;
  esac
}

ensure_basics() {
  detect_pm
  for c in curl; do command -v "$c" >/dev/null 2>&1 || pkg_install "$c"; done
  [ -e /etc/ssl/certs/ca-certificates.crt ] || [ -e /etc/pki/tls/certs/ca-bundle.crt ] || pkg_install ca-certificates
}

node_major() { command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' || echo 0; }

install_node22() {
  if [ "$(node_major)" -ge 22 ]; then echo "Node.js $(node --version) already installed"; return; fi
  echo "Adding the NodeSource repository for Node.js 22"
  if [ "$PM" = apt ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    "$PM" install -y -q nodejs
  fi
  echo "Installed Node.js $(node --version)"
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then echo "Docker $(docker --version) already installed"; return; fi
  echo "Running the official Docker install script (get.docker.com)"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker --version
}

install_webstack() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq nginx mariadb-server php-fpm php-mysql php-curl php-gd php-mbstring php-xml php-zip php-intl php-imagick unzip curl wget > /dev/null 2>&1
  systemctl enable --now nginx >/dev/null 2>&1 || true
  systemctl enable --now mariadb >/dev/null 2>&1 || true
}

setup_wp_db() {
  [ -z "$WP_DOMAIN" ] && { echo "WP_DOMAIN required" >&2; exit 1; }
  WP_DB_NAME="wp_$(echo $WP_DOMAIN | tr -cd 'a-z0-9' | head -c 8)_$(date +%s | tail -c 6)"
  WP_DB_USER="wp_$(date +%s | tail -c 6)"
  WP_DB_PASS=$(openssl rand -base64 16 | tr -d '/+=')
  mysql -e "CREATE DATABASE IF NOT EXISTS \`$WP_DB_NAME\`;" 2>/dev/null || true
  mysql -e "CREATE USER IF NOT EXISTS '$WP_DB_USER'@'localhost' IDENTIFIED BY '$WP_DB_PASS';" 2>/dev/null || true
  mysql -e "GRANT ALL PRIVILEGES ON \`$WP_DB_NAME\`.* TO '$WP_DB_USER'@'localhost'; FLUSH PRIVILEGES;" 2>/dev/null || true
  echo "DB_NAME=$WP_DB_NAME" >> /root/.wp-creds
  echo "DB_USER=$WP_DB_USER" >> /root/.wp-creds
  echo "DB_PASS=$WP_DB_PASS" >> /root/.wp-creds
  chmod 600 /root/.wp-creds
}

download_wp() {
  WP_ROOT="/var/www/${WP_DOMAIN}"
  mkdir -p $WP_ROOT
  cd $WP_ROOT
  curl -sL https://wordpress.org/latest.tar.gz | tar xz --strip-components=1
  chown -R www-data:www-data $WP_ROOT
  find $WP_ROOT -type d -exec chmod 755 {} \;
  find $WP_ROOT -type f -exec chmod 644 {} \;
}

configure_wp_nginx() {
  PHP_VER=$(ls /etc/php/ 2>/dev/null | head -1)
  [ -z "$PHP_VER" ] && PHP_VER="8.1"
  cat > /etc/nginx/sites-available/$WP_DOMAIN << NGINX
server {
    listen 80;
    server_name $WP_DOMAIN;
    root /var/www/$WP_DOMAIN;
    index index.php index.html index.htm;

    location / {
        try_files \$uri \$uri/ /index.php?\$args;
    }

    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php${PHP_VER}-fpm.sock;
        fastcgi_param SCRIPT_FILENAME \$document_root\$fastcgi_script_name;
        include fastcgi_params;
    }

    location ~ /\.ht {
        deny all;
    }
}
NGINX
  ln -sf /etc/nginx/sites-available/$WP_DOMAIN /etc/nginx/sites-enabled/
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
}

setup_wp_install() {
  WP_ROOT="/var/www/${WP_DOMAIN}"
  source /root/.wp-creds 2>/dev/null || true
  WP_TITLE=${WP_TITLE:-"$WP_DOMAIN"}
  WP_ADMIN_USER=${WP_ADMIN_USER:-admin}
  WP_ADMIN_PASS=$(openssl rand -base64 12 | tr -d '/+=')
  WP_ADMIN_EMAIL=${WP_ADMIN_EMAIL:-admin@$WP_DOMAIN}
  cp $WP_ROOT/wp-config-sample.php $WP_ROOT/wp-config.php
  sed -i "s/database_name_here/$DB_NAME/" $WP_ROOT/wp-config.php
  sed -i "s/username_here/$DB_USER/" $WP_ROOT/wp-config.php
  sed -i "s/password_here/$DB_PASS/" $WP_ROOT/wp-config.php
  sed -i "/'AUTH_KEY'/d;/'SECURE_AUTH_KEY'/d;/'LOGGED_IN_KEY'/d;/'NONCE_KEY'/d;/'AUTH_SALT'/d;/'SECURE_AUTH_SALT'/d;/'LOGGED_IN_SALT'/d;/'NONCE_SALT'/d" $WP_ROOT/wp-config.php
  curl -s https://api.wordpress.org/secret-key/1.1/salt/ >> $WP_ROOT/wp-config.php
  chown www-data:www-data $WP_ROOT/wp-config.php
  WP_URL="http://$WP_DOMAIN"
  if command -v wp >/dev/null 2>&1; then
    cd $WP_ROOT && wp core install --url="$WP_URL" --title="$WP_TITLE" --admin_user="$WP_ADMIN_USER" --admin_password="$WP_ADMIN_PASS" --admin_email="$WP_ADMIN_EMAIL" --allow-root 2>&1 | tail -5
  fi
  echo "WP_URL=$WP_URL" >> /root/.wp-creds
  echo "WP_ADMIN_USER=$WP_ADMIN_USER" >> /root/.wp-creds
  echo "WP_ADMIN_PASS=$WP_ADMIN_PASS" >> /root/.wp-creds
  echo "WP_ADMIN_EMAIL=$WP_ADMIN_EMAIL" >> /root/.wp-creds
  chmod 600 /root/.wp-creds
}
