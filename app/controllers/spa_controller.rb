# Serves the built client.
#
# The Vite build writes to public/, so in production Rails' static file server
# handles every asset and this controller only ever gets asked for the entry
# point. In development the client runs on the Vite dev server instead, and this
# renders a signpost rather than pretending the app is missing.
class SpaController < ActionController::Base
  def index
    index_path = Rails.public_path.join("index.html")

    if index_path.exist?
      render file: index_path, layout: false, content_type: "text/html"
    else
      render html: development_notice.html_safe, layout: false, status: :ok
    end
  end

  private

  def development_notice
    <<~HTML
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>Glass Court — client not built</title>
          <style>
            body { background:#04060a; color:#e8edf4; font: 15px/1.6 system-ui, sans-serif;
                   display:grid; place-items:center; height:100vh; margin:0; }
            div { max-width: 34rem; padding: 2rem; }
            code { background:#11161f; padding:.15rem .4rem; border-radius:.3rem;
                   font-family: ui-monospace, monospace; color:#4de8ff; }
            h1 { font-size: 1.4rem; margin: 0 0 .75rem; }
            p { color:#94a3b8; }
          </style>
        </head>
        <body>
          <div>
            <h1>The client has not been built yet.</h1>
            <p>
              For development, run the Vite dev server and use it directly — it proxies
              <code>/api</code> and <code>/cable</code> back to Rails:
            </p>
            <p><code>cd client &amp;&amp; npm run dev</code> → <a href="http://localhost:5173" style="color:#00d4ff">localhost:5173</a></p>
            <p>For a production-style run, build it into <code>public/</code> instead:</p>
            <p><code>cd client &amp;&amp; npm run build</code></p>
          </div>
        </body>
      </html>
    HTML
  end
end
