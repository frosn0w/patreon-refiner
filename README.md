# Patreon Refiner

## 部署步骤 (ARM Ubuntu)

1. **构建镜像**:
   `docker build -t patreon-refiner .`

2. **启动容器**:
   `docker run -d -p 3000:3000 --name refiner -v $(pwd)/public_outputs:/app/public_outputs patreon-refiner`

3. **访问地址**:
   打开浏览器访问 `http://<服务器IP>:3000`