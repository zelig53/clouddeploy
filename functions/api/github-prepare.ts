export const onRequestPost: PagesFunction = async ({ request }) => {
  try {
    const { githubToken, repoName } = await request.json() as any;
    if (!githubToken || !repoName) {
      return Response.json({ error: "Missing GitHub credentials or repo name" }, { status: 400 });
    }

    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${githubToken}`, "User-Agent": "CloudDeploy-Mobile", Accept: "application/json" },
    });
    const userData = await userRes.json() as any;
    const username = userData.login;
    if (!username) throw new Error("Failed to get GitHub username");

    let repoRes = await fetch(`https://api.github.com/repos/${username}/${repoName}`, {
      headers: { Authorization: `Bearer ${githubToken}`, "User-Agent": "CloudDeploy-Mobile", Accept: "application/json" },
    });

    if (repoRes.status === 404) {
      repoRes = await fetch("https://api.github.com/user/repos", {
        method: "POST",
        headers: { Authorization: `Bearer ${githubToken}`, "User-Agent": "CloudDeploy-Mobile", "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name: repoName, description: "Deployed from CloudDeploy", private: false, auto_init: true }),
      });
      if (!repoRes.ok) {
        const err = await repoRes.json() as any;
        throw new Error(`Failed to create repository: ${err.message}`);
      }
    }

    return Response.json({ success: true, username });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
};
