# --- Derleme aşaması: ebeveyn paneli + sunucu ---
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# Masaüstü uygulaması bu imajda gerekmez; yalnızca sunucu ve panel çalışma alanları kurulur.
RUN npm install --ignore-scripts --workspace @dr/server --workspace @dr/web --workspace @dr/shared --include-workspace-root
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/web apps/web
RUN npm run build -w @dr/web && npm run build -w @dr/server
RUN mkdir /runtime && node -e "const p=require('./apps/server/package.json');delete p.dependencies['@dr/shared'];require('fs').writeFileSync('/runtime/package.json',JSON.stringify({name:'dr-runtime',private:true,type:'module',dependencies:p.dependencies}))"

# --- Çalışma aşaması ---
FROM node:24-slim
ENV NODE_ENV=production \
    DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build /runtime/package.json ./package.json
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/web/dist ./dist/web
COPY --from=build /app/apps/server/fonts ./dist/fonts
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/standalone.js"]
