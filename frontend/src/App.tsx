import { Suspense, lazy } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { backTarget } from "./backLink";
import BottomNav from "./components/BottomNav";
import Loading from "./components/Loading";
import Home from "./pages/Home";
import Host from "./pages/Host";
import HostManage from "./pages/HostManage";
import Playlist from "./pages/Playlist";
import Playlists from "./pages/Playlists";
import Settings from "./pages/Settings";
import Songs from "./pages/Songs";
import Spinner from "./pages/Spinner";
import Usdb from "./pages/Usdb";
import User from "./pages/User";
import UserAccounts from "./pages/UserAccounts";
import UserPermissions from "./pages/UserPermissions";

// Split out on its own: the stats page is the only echarts user, and echarts is
// larger than the rest of the app put together. Every other page stays eager —
// they share the same handful of components anyway.
const Scores = lazy(() => import("./pages/Scores"));

export default function App() {
  const location = useLocation();
  // The host screen is a TV view, not a phone: no tab bar on it — and none on
  // the management pages it opens either, whose tab bar would lead the host
  // straight back into the phone chrome this view exists to avoid. Such a page
  // is recognised by the way back it was given (see `backLink`), which lives in
  // the history entry and so survives a reload: chrome and back arrow keep
  // agreeing. A URL opened without that state — typed, shared, a new tab — is an
  // ordinary phone page and keeps its tab bar.
  const onHost =
    location.pathname === "/host" ||
    location.pathname.startsWith("/host/") ||
    (backTarget(location.state)?.startsWith("/host") ?? false);

  return (
    <>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/spinner" element={<Spinner />} />
          <Route path="/songs" element={<Songs />} />
          <Route path="/songs/playlists" element={<Playlists />} />
          <Route path="/songs/playlists/:playlistId" element={<Playlist />} />
          <Route path="/usdb" element={<Usdb />} />
          <Route path="/scores" element={<Scores />} />
          <Route path="/user" element={<User />} />
          <Route path="/user/accounts" element={<UserAccounts />} />
          <Route path="/user/permissions" element={<UserPermissions />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/host" element={<Host />} />
          <Route path="/host/manage" element={<HostManage />} />
        </Routes>
      </Suspense>
      {!onHost && <BottomNav />}
    </>
  );
}
