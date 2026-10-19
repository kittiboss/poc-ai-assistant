# Same base as the original postgres:17-alpine service so existing data volumes keep
# their OS/collation behaviour; pgvector is compiled in for product-knowledge retrieval.
FROM postgres:17-alpine
ARG PGVECTOR_VERSION=0.8.0
RUN apk add --no-cache --virtual .pgvector-build git build-base \
  && git clone --branch "v${PGVECTOR_VERSION}" --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector \
  && cd /tmp/pgvector \
  # Portable build (no -march=native) and no LLVM bitcode, which needs the server's exact clang.
  && make OPTFLAGS="" with_llvm=no \
  && make install with_llvm=no \
  && cd / && rm -rf /tmp/pgvector \
  && apk del .pgvector-build
