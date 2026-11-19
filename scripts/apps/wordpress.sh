TOTAL_STEPS=7

step 1 "Checking system requirements"; ensure_basics
step 2 "Installing web stack (Nginx, PHP, MySQL)"; install_webstack
step 3 "Configuring database"; setup_wp_db
step 4 "Downloading WordPress"; download_wp
step 5 "Configuring Nginx vhost"; configure_wp_nginx
step 6 "Setting up WordPress"; setup_wp_install
step 7 "Finalizing"; echo "Done: WordPress installed at $WP_URL"
