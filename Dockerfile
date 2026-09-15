ARG TARGETARCH
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY index.html vite.config.js ./
COPY src ./src
COPY shared ./shared
COPY public ./public
RUN npm run build && npm prune --omit=dev

FROM openvino/ubuntu24_runtime:2026.3.0 AS runtime-amd64
FROM ubuntu:24.04 AS runtime-arm64
FROM runtime-${TARGETARCH}
ARG TARGETARCH
USER root
COPY --from=build /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv libsndfile1 libstdc++6 ca-certificates coreutils && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/ytdlp && /opt/ytdlp/bin/pip install --no-cache-dir 'yt-dlp[default]'
COPY separator/requirements.txt /opt/haohaochang-separator/requirements.txt
RUN python3 -m venv --system-site-packages /opt/separator \
    && /opt/separator/bin/pip install --no-cache-dir torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
    && /opt/separator/bin/pip install --no-cache-dir -r /opt/haohaochang-separator/requirements.txt numpy==1.26.4
COPY separator/*.py /opt/haohaochang-separator/
COPY separator/DEMUCS-LICENSE.txt separator/INTEL-MODEL-CARD.md /opt/models/
RUN if [ "$TARGETARCH" = amd64 ]; then \
      /opt/separator/bin/python -c "import openvino; print(openvino.__version__)" \
      && /opt/separator/bin/python /opt/haohaochang-separator/npu_model.py /opt/models; \
    fi
ENV NODE_ENV=production PORT=3210 DATA_DIR=/data DOWNLOAD_DIR=/download MEDIA_ROOTS=/media YTDLP=/opt/ytdlp/bin/yt-dlp KTV_EMBEDDED_SEPARATION=1
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server
COPY shared ./shared
EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
