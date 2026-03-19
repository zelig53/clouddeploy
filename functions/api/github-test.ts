export const onRequestPost: PagesFunction = async ({ request }) => {
  try {
    const { githubToken } = await request.json() as any;
    if (!githubToken) return Response.json({ error: "Missing GitHub token" }, { status: 400 });

    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "User-Agent": "CloudDeploy-Mobile",
      },
    });

    if (!response.ok) {
      const err = await response.json() as any;
      return Response.json({ error: err.message || "Invalid token" }, { status: 401 });
    }

    const data = await response.json() as any;
    return Response.json({ success: true, username: data.login });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
};
