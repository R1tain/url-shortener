# URL短链接转换工具

一个基于 Cloudflare Workers 的轻量级 URL 短链接服务，提供简单易用的短链接生成和管理功能。

## 功能特点

- **快速生成短链接**：将长 URL 转换为简短易记的链接
- **自定义短链路径**：支持自定义短链接路径，使链接更具辨识度
- **管理界面**：直观的 Web 界面，轻松管理所有短链接
- **搜索功能**：快速查找已创建的短链接
- **安全认证**：基本身份验证保护管理界面
- **速率限制**：防止滥用的请求速率限制
- **无服务器架构**：基于 Cloudflare Workers，无需维护服务器

## 技术栈

- **Cloudflare Workers**：无服务器计算平台
- **Cloudflare D1**：边缘 SQL 数据库
- **JavaScript**：前端和后端逻辑
- **Bootstrap 5**：响应式 UI 框架

## 部署指南

### 前提条件

- Cloudflare 账户
- 已安装 [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)

### 步骤

1. **克隆仓库**

```bash
git clone https://github.com/yourusername/url-shortener.git
cd url-shortener
wrangler login
```
```bash
wrangler login
```

2. **创建 D1 数据库**
```bash
wrangler d1 create url-shortener-db
```

3. **更新 wrangler.toml 文件**
   
将创建的数据库信息database_id 添加到 wrangler.toml 文件中：
```bash
vim wrangler.toml
```
4. **创建数据库表**
```bash
wrangler d1 execute url-shortener-db --file=./schema.sql

```
如果执行失败手动去Cloudfalre修改.
如果您需要手动更新数据库架构而不使用 `wrangler d1 execute` 命令，可以通过 Cloudflare Dashboard 直接操作。以下是详细步骤：

#### 通过 Cloudflare Dashboard 更新数据库架构

##### 1. 登录 Cloudflare Dashboard
- 访问 [https://dash.cloudflare.com/](https://dash.cloudflare.com/)
- 使用您的 Cloudflare 账号登录

##### 2. 导航到 Workers & Pages
- 在左侧菜单中点击 **"Workers & Pages"**

##### 3. 访问 D1 数据库
- 在顶部导航栏中点击 **"D1"**
- 找到并选择您的 `url_shortener_db` 数据库

##### 4. 打开查询界面
- 点击 **"Query"** 选项卡，打开 SQL 查询界面

##### 5. 执行 SQL 命令
复制以下 SQL 命令到查询框中并依次执行：

###### 删除现有表（如果存在）
```sql
DROP TABLE IF EXISTS url_mappings;
```

###### 创建新表
```bash
CREATE TABLE url_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  short_url TEXT NOT NULL UNIQUE,
  long_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```
###### 创建短链接索引
```bash
CREATE INDEX idx_short_url ON url_mappings(short_url);
```
###### 创建长链接索引
```bash
CREATE INDEX idx_long_url ON url_mappings(long_url);
```
###### 检查数据库是否正确配置

完成架构更新后，您可以执行以下查询来验证数据库是否正确配置：

插入测试数据
```bash
INSERT INTO url_mappings (short_url, long_url, created_at) 
VALUES ('test', 'https://example.com', '2023-01-01T00:00:00Z');
```
###### 查询测试数据
```bash
SELECT * FROM url_mappings WHERE short_url = 'test';
```
###### 删除测试数据
```bash
DELETE FROM url_mappings WHERE short_url = 'test';
```
以上步骤完成后，您的数据库架构应已成功更新并通过测试验证。



5. **修改配置**
在 src/index.js 文件中，修改管理员凭据：
```bash
const ADMIN_USERNAME = 'your-username';
const ADMIN_PASSWORD = 'your-secure-password';

```
6. **部署应用**
```bash
wrangler deploy
```
## 使用方法

### 访问管理界面

访问 `https://your-worker-url/translate` 并使用配置的管理员凭据登录。

### 创建短链接

1. 在管理界面的"创建短链接"标签页中输入长 URL
2. 可选：自定义短链接路径
3. 点击"生成短链接"按钮
4. 复制生成的短链接

### 管理短链接

1. 切换到"管理短链接"标签页
2. 查看所有已创建的短链接
3. 使用搜索框查找特定链接
4. 点击删除按钮移除不需要的链接

## 安全注意事项

- 定期更改管理员密码
- 避免使用短链接服务分享敏感信息
- 系统包含基本的 URL 验证，但仍应谨慎使用

## 自定义与扩展

### 修改速率限制

在 `src/index.js` 文件中调整速率限制参数：

```javascript
const RATE_LIMIT = {
    MAX_REQUESTS: 10, // 最大请求次数
    WINDOW_SIZE: 60,  // 时间窗口（秒）
};
```
### 添加更多功能

可以考虑添加的功能：
- 点击统计
- 链接过期时间
- QR 码生成
- 更多的 URL 验证规则

## 贡献

欢迎提交 Pull Request 或创建 Issue 来帮助改进这个项目。

## 许可证

[MIT License](LICENSE)

## 致谢

- [Cloudflare Workers](https://workers.cloudflare.com/) - 提供无服务器计算平台
- [Bootstrap](https://getbootstrap.com/) - 提供 UI 组件和样式
- [Bootstrap Icons](https://icons.getbootstrap.com/) - 提供图标集

---

**注意**：此项目仅用于学习和演示目的。在生产环境中使用前，请确保进行全面的安全审查和测试。

