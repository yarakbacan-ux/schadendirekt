# S3 service only; Docker Hub community images are no longer available.
FROM golang:1.24.8-bookworm AS build
WORKDIR /src
RUN git clone https://github.com/minio/minio.git . \
    && git checkout 9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a \
    && CGO_ENABLED=0 go build -o /minio .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /data && chown 10001:10001 /data
COPY --from=build /minio /usr/local/bin/minio
USER 10001:10001
EXPOSE 9000
VOLUME ["/data"]
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--address", "0.0.0.0:9000"]
