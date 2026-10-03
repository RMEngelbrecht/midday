// Unknown paths answer with a real HTTP 404. A page calling notFound() would
// return 200: the locale provider suspends, so the response status is
// committed before the not-found boundary renders.
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Page not found | Midday</title>
    <style>
      body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: system-ui, sans-serif; background: #f7f7f7; color: #121212; }
      main { max-width: 28rem; padding: 1rem; text-align: center; }
      p { color: #878787; font-size: 0.875rem; margin: 1rem 0 1.5rem; }
      a { display: inline-block; padding: 0.5rem 1rem; border: 1px solid #dcdcdc; color: inherit; text-decoration: none; font-size: 0.875rem; }
      @media (prefers-color-scheme: dark) { body { background: #0c0c0c; color: #f5f5f3; } a { border-color: #2c2c2c; } }
    </style>
  </head>
  <body>
    <main>
      <h2>Page not found</h2>
      <p>The page you are looking for does not exist.</p>
      <a href="/">Go to dashboard</a>
    </main>
  </body>
</html>`;

export function GET() {
  return new Response(html, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export const HEAD = GET;
