# Dedicated Wortkarten domain only; standard external HTTP port.
server {
    listen %ip%:80;
    server_name %domain_idn% %alias_idn%;
    access_log /var/log/nginx/domains/%domain%.log combined;
    error_log /var/log/nginx/domains/%domain%.error.log error;
    client_max_body_size 2m;
    location ~ /\.(?!well-known/|file) { deny all; return 404; }
    location / {
        proxy_pass http://127.0.0.1:3011;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache off;
        proxy_read_timeout 60s;
    }
    include %home%/%user%/conf/web/%domain%/nginx.forcessl.conf*;
    include %home%/%user%/conf/web/%domain%/nginx.conf_*;
}
