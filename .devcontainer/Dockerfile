FROM node:22-slim

# キャッシュバスター
ARG BUILDKIT_INLINE_CACHE=0
ENV CACHE_BUST=2025-06-27

# system パッケージを最小限インストール（sudoも追加）
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    python3 python3-pip git sudo curl zip unzip \
 && rm -rf /var/lib/apt/lists/*

# 既存のAWS CLI v1を削除（もしインストールされていた場合）
RUN pip3 uninstall awscli -y || true

# AWS CLI v2 をインストール
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
 && unzip awscliv2.zip \
 && ./aws/install \
 && rm -rf awscliv2.zip aws

# CDK CLI／TypeScriptツールをグローバルインストール
RUN npm install -g aws-cdk@latest typescript@latest ts-node@latest

# node ユーザーにsudo権限を付与
RUN echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# グローバルnpmディレクトリの権限を設定
RUN chown -R node:node /usr/local/lib/node_modules \
 && chown -R node:node /usr/local/bin \
 && chmod -R 755 /usr/local/lib/node_modules

# ワークディレクトリを作成し、権限を設定
RUN mkdir -p /workspace/simplechat && chown -R node:node /workspace

# ワークディレクトリ
WORKDIR /workspace/simplechat

# node 標準ユーザーに切り替え
USER node