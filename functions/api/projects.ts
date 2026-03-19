export const onRequestGet: PagesFunction = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const accountId = url.searchParams.get("accountId");
    const apiToken = url.searchParams.get("apiToken");

    if (!accountId || !apiToken) {
      return Response.json({ error: "Missing Cloudflare credentials" }, { status: 400 });
    }

    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    const data = await res.json() as any;
    if (!res.ok) throw new Error(data.errors?.[0]?.message || "Failed to fetch projects");

    return Response.json(data.result);
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
};
