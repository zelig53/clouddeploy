export const onRequestPost: PagesFunction = async ({ request }) => {
  try {
    const { accountId, apiToken, projectName, deploymentId } = await request.json() as any;
    if (!accountId || !apiToken || !projectName || !deploymentId) {
      return Response.json({ error: "Missing parameters" }, { status: 400 });
    }

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${projectName}/deployments/${deploymentId}/rollback`,
      { method: "POST", headers: { Authorization: `Bearer ${apiToken}` } }
    );
    const data = await res.json() as any;
    if (!res.ok) throw new Error(data.errors?.[0]?.message || "Rollback failed");

    return Response.json(data.result);
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
};
