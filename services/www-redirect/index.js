// www.libraries.dev has no origin of its own; send every request to the apex,
// keeping the path and query, so old or typed www links land on the site.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.hostname = "libraries.dev";
    url.protocol = "https:";
    url.port = "";
    return Response.redirect(url.toString(), 301);
  },
};
