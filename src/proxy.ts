import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

/**
 * Runs on the web server before every page. Nobody without a hub login
 * gets any page except /signin and /signup; signed-in people are sent away
 * from them. Every hub function also checks, on the Convex backend, who the
 * caller is and what their profile type allows, and the pages check again.
 */
const isSignInPage = createRouteMatcher(["/signin", "/signup"]);

export const proxy = convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const signedIn = await convexAuth.isAuthenticated();
  if (isSignInPage(request)) {
    return signedIn ? nextjsMiddlewareRedirect(request, "/") : undefined;
  }
  if (!signedIn) {
    // Coming back from a tool whose login ended (/open/<tool>): sign in, then carry on there.
    const next = request.nextUrl.pathname.startsWith("/open/") ? `?next=${encodeURIComponent(request.nextUrl.pathname)}` : "";
    return nextjsMiddlewareRedirect(request, `/signin${next}`);
  }
});

export const config = {
  // Everything except Next.js internals and static files.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
