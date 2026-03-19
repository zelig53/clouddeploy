export const onRequestPost: PagesFunction = async ({ request }) => {
  try {
    const { githubToken, repoName, head } = await request.json() as any;
    if (!githubToken || !repoName || !head) {
      return Response.json({ error: "Missing parameters" }, { status: 400 });
    }

    const GH = (url: string, opts: RequestInit = {}) =>
      fetch(url, { ...opts, headers: { Authorization: `Bearer ${githubToken}`, "User-Agent": "CloudDeploy-Mobile", Accept: "application/json", "Content-Type": "application/json" } });

    const userRes = await GH("https://api.github.com/user");
    const { login: username } = await userRes.json() as any;

    const mergeRes = await GH(`https://api.github.com/repos/${username}/${repoName}/merges`, {
      method: "POST",
      body: JSON.stringify({ base: "main", head, commit_message: `Promote ${head} to production` }),
    });

    if (!mergeRes.ok) {
      const e = await mergeRes.json() as any;
      throw new Error(`Merge failed: ${e.message}`);
    }

    return Response.json({ success: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
};
