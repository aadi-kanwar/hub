import {
  convexAuthNextjsMiddleware,
  createRouteMatcher,
  nextjsMiddlewareRedirect,
} from "@convex-dev/auth/nextjs/server";

/**
 * Runs on the web server before every page. Nobody without a hub login
 * gets any page except /signin; signed-in people are sent away from /signin.
 * Every hub function also checks, on the Convex backend, that the caller is
 * an active master admin, and the pages check again in the browser.
 */
const isSignInPage = createRouteMatcher(["/signin"]);

export const proxy = convexAuthNextjsMiddleware(async (request, { convexAuth }) => {
  const signedIn = await convexAuth.isAuthenticated();
  if (isSignInPage(request)) {
    return signedIn ? nextjsMiddlewareRedirect(request, "/") : undefined;
  }
  if (!signedIn) return nextjsMiddlewareRedirect(request, "/signin");
});

export const config = {
  // Everything except Next.js internals and static files.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
