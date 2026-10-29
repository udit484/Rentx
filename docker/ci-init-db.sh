#!/bin/sh
set -eu
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=db_user="$DB_USER" --set=db_password="$DB_PASSWORD" <<'SQL'
CREATE ROLE :"db_user" LOGIN PASSWORD :'db_password';
CREATE DATABASE rentx_auth OWNER :"db_user";
CREATE DATABASE rentx_users OWNER :"db_user";
CREATE DATABASE rentx_products OWNER :"db_user";
CREATE DATABASE rentx_bookings OWNER :"db_user";
CREATE DATABASE rentx_payments OWNER :"db_user";
CREATE DATABASE rentx_notifications OWNER :"db_user";
SQL
