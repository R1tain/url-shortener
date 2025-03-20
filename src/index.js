// 配置管理员账号
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'xxxxxxxxxx';

// 速率限制配置和存储
const RATE_LIMIT = {
    MAX_REQUESTS: 10, // 最大请求次数
    WINDOW_SIZE: 60,  // 时间窗口（秒）
};
const RATE_LIMITS = new Map();

// 处理请求
export default {
    async fetch(request, env, ctx) {
        return await handleRequest(request, env);
    }
};

async function handleRequest(request, env) {
    // 获取客户端IP
    const clientIP = request.headers.get('CF-Connecting-IP') || '0.0.0.0';

    // 检查速率限制
    const rateCheckPassed = checkRateLimit(clientIP);
    if (!rateCheckPassed) {
        return new Response('Too Many Requests', {
            status: 429,
            headers: {
                'Retry-After': RATE_LIMIT.WINDOW_SIZE,
                'Content-Type': 'text/plain'
            }
        });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // 处理根路径请求，返回404
    if (path === '/') {
        return new Response('404 Not Found', { status: 404 });
    }

    // 处理转换页面请求
    if (path === '/translate') {
        // 检查认证
        const authorization = request.headers.get('Authorization');
        if (!authorization) {
            return new Response('Unauthorized', {
                status: 401,
                headers: {
                    'WWW-Authenticate': 'Basic realm="Admin Access", charset="UTF-8"'
                }
            });
        }

        // 验证认证信息
        const [scheme, encoded] = authorization.split(' ');
        if (!encoded || scheme !== 'Basic') {
            return new Response('Invalid authentication', { status: 401 });
        }

        const decoded = atob(encoded);
        const [username, password] = decoded.split(':');

        if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
            return new Response('Invalid credentials', { status: 401 });
        }

        // 认证通过，返回转换页面
        return new Response(getTranslateHtml(), {
            headers: { 'Content-Type': 'text/html' }
        });
    }

    // 处理API请求
    if (path.startsWith('/api/')) {
        // 检查认证
        const authorization = request.headers.get('Authorization');
        if (!authorization) {
            return new Response('Unauthorized', {
                status: 401,
                headers: {
                    'WWW-Authenticate': 'Basic realm="Admin Access", charset="UTF-8"'
                }
            });
        }

        // 验证认证信息
        const [scheme, encoded] = authorization.split(' ');
        if (!encoded || scheme !== 'Basic') {
            return new Response('Invalid authentication', { status: 401 });
        }

        const decoded = atob(encoded);
        const [username, password] = decoded.split(':');

        if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
            return new Response('Invalid credentials', { status: 401 });
        }

        return handleApiRequest(request, env);
    }

    // 处理短链接重定向
    const shortUrl = path.substring(1); // 移除前导斜杠

    try {
        // 从数据库中查询长链接
        const { results } = await env.DB.prepare(
            "SELECT long_url FROM url_mappings WHERE short_url = ?"
        ).bind(shortUrl).all();

        if (results && results.length > 0) {
            const longUrl = results[0].long_url;
            return Response.redirect(longUrl, 301);
        }

        // 如果没有匹配的短链接，返回404
        return new Response('404 Not Found', { status: 404 });
    } catch (error) {
        return new Response(`Database error: ${error.message}`, { status: 500 });
    }
}

// 处理API请求
async function handleApiRequest(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 缩短URL的API
    if (path === '/api/shorten' && request.method === 'POST') {
        try {
            const { longUrl, customPath } = await request.json();

            if (!longUrl) {
                return new Response(JSON.stringify({ error: '长URL是必需的' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // 验证URL
            const urlValidation = validateUrl(longUrl);
            if (!urlValidation.valid) {
                return new Response(JSON.stringify({ error: urlValidation.reason }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // 首先检查该长链接是否已经存在
            const { results: existingUrls } = await env.DB.prepare(
                "SELECT short_url FROM url_mappings WHERE long_url = ?"
            ).bind(longUrl).all();

            // 如果长链接已存在，直接返回对应的短链接
            if (existingUrls && existingUrls.length > 0) {
                const shortUrl = `${url.origin}/${existingUrls[0].short_url}`;
                return new Response(JSON.stringify({
                    shortUrl,
                    message: '该长链接已存在对应的短链接'
                }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            let shortPath = customPath;

            // 如果没有提供自定义路径，则使用长URL的最后一部分
            if (!shortPath) {
                // 从长URL中提取最后一部分作为短链接
                const urlObj = new URL(longUrl);
                let pathSegments = urlObj.pathname.split('/').filter(segment => segment.length > 0);

                if (pathSegments.length > 0) {
                    // 使用路径的最后一部分
                    shortPath = pathSegments[pathSegments.length - 1];

                    // 如果最后一部分包含文件扩展名，去掉扩展名
                    const extensionIndex = shortPath.lastIndexOf('.');
                    if (extensionIndex > 0) {
                        shortPath = shortPath.substring(0, extensionIndex);
                    }
                } else {
                    // 如果路径为空，使用主机名的第一部分
                    shortPath = urlObj.hostname.split('.')[0];
                }

                // 确保路径只包含有效字符
                shortPath = sanitizePathSegment(shortPath);

                // 如果处理后的路径为空或太长，使用主机名
                if (!shortPath || shortPath.length > 50) {
                    shortPath = sanitizePathSegment(urlObj.hostname);
                }
            }

            // 验证自定义路径
            const validPathRegex = /^[a-zA-Z0-9_-]+$/;
            if (!validPathRegex.test(shortPath)) {
                return new Response(JSON.stringify({ error: '路径只能包含字母、数字、下划线和连字符' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // 检查路径长度
            if (shortPath.length > 50) {
                return new Response(JSON.stringify({ error: '路径长度不能超过50个字符' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // 检查是否已存在相同的短链接
            const { results } = await env.DB.prepare(
                "SELECT short_url FROM url_mappings WHERE short_url = ?"
            ).bind(shortPath).all();

            // 如果短路径已存在，添加数字后缀使其唯一
            if (results && results.length > 0) {
                let counter = 1;
                let newShortPath = `${shortPath}-${counter}`;

                // 尝试添加数字后缀，直到找到一个唯一的路径
                while (true) {
                    const { results: checkResults } = await env.DB.prepare(
                        "SELECT short_url FROM url_mappings WHERE short_url = ?"
                    ).bind(newShortPath).all();

                    if (!checkResults || checkResults.length === 0) {
                        shortPath = newShortPath;
                        break;
                    }

                    counter++;
                    newShortPath = `${shortPath}-${counter}`;

                    // 防止无限循环
                    if (counter > 100) {
                        return new Response(JSON.stringify({ error: '无法生成唯一的短链接路径' }), {
                            status: 500,
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }
                }
            }

            // 存储映射关系到数据库
            const timestamp = new Date().toISOString();

            await env.DB.prepare(
                "INSERT INTO url_mappings (short_url, long_url, created_at) VALUES (?, ?, ?)"
            ).bind(shortPath, longUrl, timestamp).run();

            const shortUrl = `${url.origin}/${shortPath}`;
            return new Response(JSON.stringify({ shortUrl }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // 获取所有短链接的API
    if (path === '/api/links' && request.method === 'GET') {
        try {
            // 获取分页参数
            const params = new URL(request.url).searchParams;
            const page = parseInt(params.get('page') || '1', 10);
            const pageSize = parseInt(params.get('pageSize') || '10', 10);
            const search = params.get('search') || '';

            // 计算偏移量
            const offset = (page - 1) * pageSize;

            // 构建查询条件
            let query = "SELECT id, short_url, long_url, created_at FROM url_mappings";
            let countQuery = "SELECT COUNT(*) as total FROM url_mappings";
            let queryParams = [];

            if (search) {
                query += " WHERE short_url LIKE ? OR long_url LIKE ?";
                countQuery += " WHERE short_url LIKE ? OR long_url LIKE ?";
                const searchPattern = `%${search}%`;
                queryParams = [searchPattern, searchPattern];
            }

            // 添加排序和分页
            query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
            queryParams.push(pageSize, offset);

            // 执行查询
            const { results } = await env.DB.prepare(query).bind(...queryParams).all();

            // 获取总记录数
            const countParams = search ? [`%${search}%`, `%${search}%`] : [];
            const { results: countResults } = await env.DB.prepare(countQuery).bind(...countParams).all();
            const total = countResults[0].total;

            // 计算总页数
            const totalPages = Math.ceil(total / pageSize);

            // 格式化结果
            const links = results.map(item => {
                return {
                    id: item.id,
                    shortUrl: `${url.origin}/${item.short_url}`,
                    shortPath: item.short_url,
                    longUrl: item.long_url,
                    createdAt: item.created_at
                };
            });

            return new Response(JSON.stringify({
                links,
                pagination: {
                    page,
                    pageSize,
                    totalItems: total,
                    totalPages
                }
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    // 删除短链接的API
    if (path === '/api/links' && request.method === 'DELETE') {
        try {
            const { id } = await request.json();

            if (!id) {
                return new Response(JSON.stringify({ error: '缺少链接ID' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // 检查链接是否存在
            const { results } = await env.DB.prepare(
                "SELECT id FROM url_mappings WHERE id = ?"
            ).bind(id).all();

            if (!results || results.length === 0) {
                return new Response(JSON.stringify({ error: '链接不存在' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // 删除链接
            await env.DB.prepare(
                "DELETE FROM url_mappings WHERE id = ?"
            ).bind(id).run();

            return new Response(JSON.stringify({
                success: true,
                message: '链接已成功删除'
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            });
        }
    }

    return new Response('Not Found', { status: 404 });
}

// 清理路径段，只保留有效字符
function sanitizePathSegment(segment) {
    if (!segment) return '';

    // 移除非字母数字字符，保留下划线和连字符
    return segment
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .substring(0, 50); // 限制长度
}

// 速率限制检查函数
function checkRateLimit(ip) {
    const now = Math.floor(Date.now() / 1000);

    if (!RATE_LIMITS.has(ip)) {
        RATE_LIMITS.set(ip, {
            count: 1,
            timestamp: now
        });
        return true;
    }

    const rateData = RATE_LIMITS.get(ip);

    // 检查是否在时间窗口内
    if (now - rateData.timestamp > RATE_LIMIT.WINDOW_SIZE) {
        // 重置计数器
        rateData.count = 1;
        rateData.timestamp = now;
        return true;
    }

    // 检查是否超过最大请求次数
    if (rateData.count >= RATE_LIMIT.MAX_REQUESTS) {
        return false;
    }

    // 增加计数器
    rateData.count += 1;
    return true;
}

// URL验证函数
function validateUrl(url) {
    // 基本URL格式验证
    try {
        new URL(url);
    } catch (e) {
        return { valid: false, reason: '无效的URL格式' };
    }

    // 检查URL协议，只允许http和https
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return { valid: false, reason: '只允许HTTP和HTTPS协议' };
    }

    // 检查是否为已知的恶意域名（可以扩展为更完整的黑名单）
    const blacklistedDomains = [
        'malware.com',
        'phishing.example',
        'suspicious.site',
        // 可以扩展更多已知的恶意网站
    ];

    const urlObj = new URL(url);
    if (blacklistedDomains.some(domain => urlObj.hostname.includes(domain))) {
        return { valid: false, reason: '检测到潜在的恶意网站' };
    }

    // 可以添加更多验证规则，例如：
    // 1. 检查URL长度
    if (url.length > 2000) {
        return { valid: false, reason: 'URL长度超过限制' };
    }

    // 2. 检查是否包含特定的危险关键字
    const dangerousKeywords = ['malware', 'phishing', 'hack', 'crack', 'warez'];
    if (dangerousKeywords.some(keyword => url.toLowerCase().includes(keyword))) {
        return { valid: false, reason: '检测到可疑关键字' };
    }

    return { valid: true };
}

// 获取转换页面HTML
function getTranslateHtml() {
    return `<!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>URL短链接转换</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css">
        <style>
            body {
                padding-top: 50px;
                padding-bottom: 50px;
            }
            .container {
                max-width: 900px;
            }
            .result {
                margin-top: 20px;
                display: none;
            }
            .tab-content {
                padding-top: 20px;
            }
            .link-table {
                font-size: 0.9rem;
            }
            .link-table .long-url {
                max-width: 300px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .pagination {
                margin-top: 20px;
                justify-content: center;
            }
            .search-box {
                margin-bottom: 20px;
            }
            .loading-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background-color: rgba(255, 255, 255, 0.8);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 1000;
                display: none;
            }
            .spinner-container {
                text-align: center;
            }
            .action-btn {
                cursor: pointer;
            }
            .btn-icon {
                padding: 0.25rem 0.5rem;
            }
        </style>
    </head>
    <body>
        <div class="loading-overlay" id="loadingOverlay">
            <div class="spinner-container">
                <div class="spinner-border text-primary" role="status"></div>
                <p class="mt-2">处理中，请稍候...</p>
            </div>
        </div>

        <div class="container">
            <ul class="nav nav-tabs" id="myTab" role="tablist">
                <li class="nav-item" role="presentation">
                    <button class="nav-link active" id="create-tab" data-bs-toggle="tab" data-bs-target="#create" type="button" role="tab" aria-controls="create" aria-selected="true">创建短链接</button>
                </li>
                <li class="nav-item" role="presentation">
                    <button class="nav-link" id="manage-tab" data-bs-toggle="tab" data-bs-target="#manage" type="button" role="tab" aria-controls="manage" aria-selected="false">管理短链接</button>
                </li>
            </ul>

            <div class="tab-content" id="myTabContent">
                <!-- 创建短链接标签页 -->
                <div class="tab-pane fade show active" id="create" role="tabpanel" aria-labelledby="create-tab">
                    <h2 class="mb-4">URL短链接转换工具</h2>

                    <div class="card">
                        <div class="card-body">
                            <form id="shortenForm">
                                <div class="mb-3">
                                    <label for="longUrl" class="form-label">长链接</label>
                                    <input type="url" class="form-control" id="longUrl" placeholder="请输入需要转换的完整URL" required>
                                    <div class="form-text">例如: https://raw.githubusercontent.com/R1tain/script/main/clear_history.sh</div>
                                </div>

                                <div class="mb-3">
                                    <label for="customPath" class="form-label">自定义短链接路径 (可选)</label>
                                    <input type="text" class="form-control" id="customPath" placeholder="留空将使用原链接的最后一部分">
                                    <div class="form-text">如果留空，将自动使用原链接的最后一部分作为短链接路径</div>
                                </div>

                                <button type="submit" class="btn btn-primary">生成短链接</button>
                            </form>
                        </div>
                    </div>

                    <div class="result card mt-4">
                        <div class="card-body">
                            <h5 class="card-title">生成的短链接</h5>
                            <div class="input-group mb-3">
                                <input type="text" class="form-control" id="shortUrl" readonly>
                                <button class="btn btn-outline-secondary" type="button" id="copyBtn">复制</button>
                            </div>
                            <div class="alert alert-success mt-2" id="copySuccess" style="display: none;">
                                已复制到剪贴板！
                            </div>
                            <div class="alert alert-info mt-2" id="existingUrlMessage" style="display: none;">
                                该长链接已存在对应的短链接
                            </div>
                        </div>
                    </div>
                </div>
                <!-- 管理短链接标签页 -->
                <div class="tab-pane fade" id="manage" role="tabpanel" aria-labelledby="manage-tab">
                    <h2 class="mb-4">管理短链接</h2>

                    <div class="search-box">
                        <div class="input-group">
                            <input type="text" class="form-control" id="searchInput" placeholder="搜索短链接或长链接...">
                            <button class="btn btn-outline-secondary" type="button" id="searchBtn">搜索</button>
                            <button class="btn btn-outline-secondary" type="button" id="clearSearchBtn">清除</button>
                        </div>
                    </div>

                    <div class="table-responsive">
                        <table class="table table-striped table-hover link-table">
                            <thead>
                                <tr>
                                    <th scope="col">#</th>
                                    <th scope="col">短链接</th>
                                    <th scope="col">原始链接</th>
                                    <th scope="col">创建时间</th>
                                    <th scope="col">操作</th>
                                </tr>
                            </thead>
                            <tbody id="linksTableBody">
                                <!-- 链接数据将在这里动态加载 -->
                            </tbody>
                        </table>
                    </div>

                    <nav aria-label="Page navigation">
                        <ul class="pagination" id="pagination">
                            <!-- 分页控件将在这里动态加载 -->
                        </ul>
                    </nav>

                    <div class="alert alert-info mt-3" id="noLinksMessage" style="display: none;">
                        没有找到任何短链接。
                    </div>
                </div>
            </div>
        </div>

        <!-- 删除确认模态框 -->
        <div class="modal fade" id="deleteModal" tabindex="-1" aria-labelledby="deleteModalLabel" aria-hidden="true">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title" id="deleteModalLabel">确认删除</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                    </div>
                    <div class="modal-body">
                        您确定要删除这个短链接吗？此操作无法撤销。
                        <p class="mt-2 fw-bold" id="deleteUrlText"></p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">取消</button>
                        <button type="button" class="btn btn-danger" id="confirmDeleteBtn">删除</button>
                    </div>
                </div>
            </div>
        </div>
        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
        <script>
            // 全局变量
            let currentPage = 1;
            let pageSize = 10;
            let totalPages = 0;
            let currentSearch = '';
            let deleteId = null;
            let deleteModal = null;

            // 页面加载完成后执行
            document.addEventListener('DOMContentLoaded', function() {
                // 初始化标签页切换事件
                document.getElementById('manage-tab').addEventListener('click', function() {
                    loadLinks(1);
                });

                // 初始化模态框
                deleteModal = new bootstrap.Modal(document.getElementById('deleteModal'));

                // 创建短链接表单提交
                document.getElementById('shortenForm').addEventListener('submit', createShortLink);

                // 复制按钮点击事件
                document.getElementById('copyBtn').addEventListener('click', copyShortUrl);

                // 搜索按钮点击事件
                document.getElementById('searchBtn').addEventListener('click', function() {
                    currentSearch = document.getElementById('searchInput').value.trim();
                    loadLinks(1);
                });

                // 清除搜索按钮点击事件
                document.getElementById('clearSearchBtn').addEventListener('click', function() {
                    document.getElementById('searchInput').value = '';
                    currentSearch = '';
                    loadLinks(1);
                });

                // 搜索框回车事件
                document.getElementById('searchInput').addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        currentSearch = this.value.trim();
                        loadLinks(1);
                    }
                });

                // 确认删除按钮点击事件
                document.getElementById('confirmDeleteBtn').addEventListener('click', confirmDelete);
            });

            // 创建短链接函数
            async function createShortLink(e) {
                e.preventDefault();

                const longUrl = document.getElementById('longUrl').value;
                const customPath = document.getElementById('customPath').value;

                // 显示加载状态
                showLoading();

                // 隐藏之前的消息
                const errorAlert = document.getElementById('errorAlert');
                if (errorAlert) {
                    errorAlert.style.display = 'none';
                }
                document.getElementById('existingUrlMessage').style.display = 'none';

                try {
                    const response = await fetch('/api/shorten', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Basic ' + btoa('${ADMIN_USERNAME}:${ADMIN_PASSWORD}')
                        },
                        body: JSON.stringify({ longUrl, customPath })
                    });

                    const data = await response.json();

                    if (!response.ok) {
                        throw new Error(data.error || '生成短链接失败');
                    }

                    document.getElementById('shortUrl').value = data.shortUrl;
                    document.querySelector('.result').style.display = 'block';

                    // 显示已存在消息（如果适用）
                    if (data.message && data.message.includes('已存在')) {
                        document.getElementById('existingUrlMessage').style.display = 'block';
                    } else {
                        document.getElementById('existingUrlMessage').style.display = 'none';
                    }
                } catch (error) {
                    // 显示错误消息
                    let errorContainer = document.getElementById('errorAlert');
                    if (!errorContainer) {
                        errorContainer = document.createElement('div');
                        errorContainer.id = 'errorAlert';
                        errorContainer.className = 'alert alert-danger mt-3';
                        document.querySelector('.card-body').appendChild(errorContainer);
                    }
                    errorContainer.textContent = error.message;
                    errorContainer.style.display = 'block';
                } finally {
                    // 隐藏加载状态
                    hideLoading();
                }
            }

            // 复制短链接到剪贴板
            function copyShortUrl() {
                const shortUrl = document.getElementById('shortUrl');
                shortUrl.select();
                document.execCommand('copy');

                const copySuccess = document.getElementById('copySuccess');
                copySuccess.style.display = 'block';

                // 3秒后隐藏成功消息
                setTimeout(() => {
                    copySuccess.style.display = 'none';
                }, 3000);
            }

            // 加载短链接列表
            async function loadLinks(page) {
                showLoading();
                currentPage = page;

                try {
                    const url = new URL('/api/links', window.location.origin);
                    url.searchParams.append('page', page);
                    url.searchParams.append('pageSize', pageSize);

                    if (currentSearch) {
                        url.searchParams.append('search', currentSearch);
                    }

                    const response = await fetch(url, {
                        headers: {
                            'Authorization': 'Basic ' + btoa('${ADMIN_USERNAME}:${ADMIN_PASSWORD}')
                        }
                    });

                    if (!response.ok) {
                        throw new Error('加载链接失败');
                    }

                    const data = await response.json();
                    const { links, pagination } = data;

                    // 更新分页信息
                    totalPages = pagination.totalPages;

                    // 清空表格
                    const tableBody = document.getElementById('linksTableBody');
                    tableBody.innerHTML = '';

                    // 显示或隐藏"无链接"消息
                    const noLinksMessage = document.getElementById('noLinksMessage');
                    if (links.length === 0) {
                        noLinksMessage.style.display = 'block';
                    } else {
                        noLinksMessage.style.display = 'none';
                    }

                    // 添加链接到表格
                    links.forEach((link, index) => {
                        const row = document.createElement('tr');

                        // 格式化日期
                        const createdDate = new Date(link.createdAt);
                        const formattedDate = createdDate.toLocaleString('zh-CN');

                        row.innerHTML = \`
                            <td>\${(page - 1) * pageSize + index + 1}</td>
                            <td>
                                <a href="\${link.shortUrl}" target="_blank" title="\${link.shortUrl}">
                                    \${link.shortPath}
                                </a>
                                <button class="btn btn-sm btn-outline-secondary btn-icon ms-2" onclick="copyToClipboard('\${link.shortUrl}')">
                                    <i class="bi bi-clipboard"></i>
                                </button>
                            </td>
                            <td class="long-url" title="\${link.longUrl}">
                                <a href="\${link.longUrl}" target="_blank">\${link.longUrl}</a>
                            </td>
                            <td>\${formattedDate}</td>
                            <td>
                                <button class="btn btn-sm btn-danger" onclick="deleteLink(\${link.id}, '\${link.shortPath}')">
                                    <i class="bi bi-trash"></i> 删除
                                </button>
                            </td>
                        \`;

                        tableBody.appendChild(row);
                    });

                    // 创建分页控件
                    createPagination(pagination);

                } catch (error) {
                    console.error('加载链接失败:', error);
                    alert('加载链接失败: ' + error.message);
                } finally {
                    hideLoading();
                }
            }

            // 创建分页控件
            function createPagination(pagination) {
                const paginationElement = document.getElementById('pagination');
                paginationElement.innerHTML = '';

                // 如果只有一页，不显示分页
                if (pagination.totalPages <= 1) {
                    return;
                }

                // 上一页按钮
                const prevItem = document.createElement('li');
                prevItem.className = \`page-item \${pagination.page <= 1 ? 'disabled' : ''}\`;
                prevItem.innerHTML = \`
                    <a class="page-link" href="#" aria-label="Previous" \${pagination.page > 1 ? \`onclick="loadLinks(\${pagination.page - 1}); return false;"\` : ''}>
                        <span aria-hidden="true">«</span>
                    </a>
                \`;
                paginationElement.appendChild(prevItem);

                // 页码按钮
                let startPage = Math.max(1, pagination.page - 2);
                let endPage = Math.min(pagination.totalPages, pagination.page + 2);

                // 确保显示5个页码按钮（如果有足够的页数）
                if (endPage - startPage < 4 && pagination.totalPages > 4) {
                    if (startPage === 1) {
                        endPage = Math.min(5, pagination.totalPages);
                    } else if (endPage === pagination.totalPages) {
                        startPage = Math.max(1, pagination.totalPages - 4);
                    }
                }

                for (let i = startPage; i <= endPage; i++) {
                    const pageItem = document.createElement('li');
                    pageItem.className = \`page-item \${i === pagination.page ? 'active' : ''}\`;
                    pageItem.innerHTML = \`
                        <a class="page-link" href="#" onclick="loadLinks(\${i}); return false;">\${i}</a>
                    \`;
                    paginationElement.appendChild(pageItem);
                }

                // 下一页按钮
                const nextItem = document.createElement('li');
                nextItem.className = \`page-item \${pagination.page >= pagination.totalPages ? 'disabled' : ''}\`;
                nextItem.innerHTML = \`
                    <a class="page-link" href="#" aria-label="Next" \${pagination.page < pagination.totalPages ? \`onclick="loadLinks(\${pagination.page + 1}); return false;"\` : ''}>
                        <span aria-hidden="true">»</span>
                    </a>
                \`;
                paginationElement.appendChild(nextItem);
            }

            // 复制到剪贴板
            function copyToClipboard(text) {
                const tempInput = document.createElement('input');
                tempInput.value = text;
                document.body.appendChild(tempInput);
                tempInput.select();
                document.execCommand('copy');
                document.body.removeChild(tempInput);

                alert('已复制到剪贴板: ' + text);
            }

            // 删除链接（显示确认对话框）
            function deleteLink(id, shortPath) {
                deleteId = id;
                document.getElementById('deleteUrlText').textContent = shortPath;
                deleteModal.show();
            }

            // 确认删除链接
            async function confirmDelete() {
                if (!deleteId) return;

                showLoading();

                try {
                    const response = await fetch('/api/links', {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': 'Basic ' + btoa('${ADMIN_USERNAME}:${ADMIN_PASSWORD}')
                        },
                        body: JSON.stringify({ id: deleteId })
                    });

                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error || '删除失败');
                    }

                    // 关闭模态框
                    deleteModal.hide();

                    // 重新加载当前页面的链接
                    loadLinks(currentPage);

                } catch (error) {
                    console.error('删除链接失败:', error);
                    alert('删除链接失败: ' + error.message);
                } finally {
                    hideLoading();
                }
            }

            // 显示加载状态
            function showLoading() {
                document.getElementById('loadingOverlay').style.display = 'flex';
            }

            // 隐藏加载状态
            function hideLoading() {
                document.getElementById('loadingOverlay').style.display = 'none';
            }
        </script>
    </body>
    </html>`;
}
