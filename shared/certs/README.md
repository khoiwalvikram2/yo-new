# Database CA certificate (SSL)

For PostgreSQL connections that require SSL (e.g. DigitalOcean Managed Database):

1. **Download** the CA certificate from your provider (e.g. DigitalOcean → Database → Connection details → CA certificate).
2. **Place** the file here as `ca-certificate.crt`, **or** set env `DATABASE_CA_CERT` to the absolute path of the cert file.

When running **migrations** from the `shared` folder, put the cert in `shared/certs/ca-certificate.crt` (or set `DATABASE_CA_CERT`).

When running **admin-backend** or **user-backend**, put the cert in that app’s `certs/ca-certificate.crt` (e.g. `admin-backend/certs/`, `user-backend/certs/`) so the default path `<cwd>/certs/ca-certificate.crt` works, or set `DATABASE_CA_CERT` to the cert path.
