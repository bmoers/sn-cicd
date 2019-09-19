#
# Generate self signed client and server certificates.
# This is only for development purposes.
#
# source.
# https://engineering.circle.com/https-authorized-certs-with-node-js-315e548354a2
#

## eb server
openssl req -new -x509 -days 99999 -config eb-ca.cnf -keyout eb-ca-key.pem -out eb-ca-crt.pem
openssl genrsa -out eb-server-key.pem 4096
openssl req -new -config eb-server.cnf -key eb-server-key.pem -out eb-server-csr.pem
openssl x509 -req -extfile eb-server.cnf -days 99999 -passin "pass:password" -in eb-server-csr.pem -CA eb-ca-crt.pem -CAkey eb-ca-key.pem -CAcreateserial -out eb-server-crt.pem

## eb client
openssl genrsa -out eb-client-key.pem 4096
openssl req -new -config eb-client.cnf -key eb-client-key.pem -out eb-client-csr.pem
openssl x509 -req -extfile eb-client.cnf -days 99999 -passin "pass:password" -in eb-client-csr.pem -CA eb-ca-crt.pem -CAkey eb-ca-key.pem -CAcreateserial -out eb-client-crt.pem
openssl verify -CAfile eb-ca-crt.pem eb-client-crt.pem

## web server
openssl req -new -x509 -days 99999 -config server-ca.cnf -keyout server-ca-key.pem -out server-ca-crt.pem
openssl genrsa -out server-key.pem 4096
openssl req -new -config server.cnf -key server-key.pem -out server-csr.pem
openssl x509 -req -extfile server.cnf -days 99999 -passin "pass:password" -in server-csr.pem -CA server-ca-crt.pem -CAkey server-ca-key.pem -CAcreateserial -out server-crt.pem
