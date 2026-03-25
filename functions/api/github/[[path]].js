// Cloudflare Pages Function - GitHub API Proxy
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  
  // Extract path after /api/github/
  const match = url.pathname.match(/^\/api\/github\/(.*)/);
  const ghPath = match ? match[1] : '';
  
  // Build target URL with all query params
  const targetUrl = new URL(`https://api.github.com/${ghPath}`);
  url.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  const reqHeaders = {
    'Authorization': request.headers.get('Authorization') || '',
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'CloudDeploy-PWA'
  };

  const init = { method: request.method, headers: reqHeaders };
  if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
    init.body = await request.text();
  }

  try {
    const response = await fetch(targetUrl.toString(), init);
    const data = await response.text();
    return new Response(data, {
      status: response.status,
      headers: { 
        'Content-Type': 'application/json', 
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ message: String(err.message) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }
  });
}
