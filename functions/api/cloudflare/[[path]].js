// Cloudflare Pages Function - Cloudflare API Proxy
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  
  // Extract path after /api/cloudflare/
  const match = url.pathname.match(/^\/api\/cloudflare\/(.*)/);
  const cfPath = match ? match[1] : '';
  
  // Build target URL - explicitly forward all query params
  const targetUrl = new URL(`https://api.cloudflare.com/client/v4/${cfPath}`);
  
  // Copy all query parameters explicitly
  url.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  const reqHeaders = {
    'Authorization': request.headers.get('Authorization') || '',
    'Content-Type': 'application/json',
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
    return new Response(JSON.stringify({ success: false, errors: [{ message: String(err.message) }] }), {
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
