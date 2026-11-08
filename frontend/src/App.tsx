import { useQueryClient } from "@tanstack/react-query";
import { Suspense, lazy, useLayoutEffect } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import {
  getMeQueryKey,
  listGroupsQueryKey,
  listUsersQueryKey,
} from "./api/@tanstack/react-query.gen";
import { backTarget } from "./backLink";
import BottomNav from "./components/BottomNav";
import MusicSink from "./components/MusicSink";
import Loading from "./components/Loading";
import AchievementEditor from "./pages/AchievementEditor";
import Achievements from "./pages/Achievements";
import Device from "./pages/Device";
import Devices from "./pages/Devices";
import DeviceSetup from "./pages/DeviceSetup";
import GroupEditor from "./pages/GroupEditor";
import Groups from "./pages/Groups";
import Home from "./pages/Home";
import Host from "./pages/Host";
import HostManage from "./pages/HostManage";
import Playlist from "./pages/Playlist";
import PlaylistManage from "./pages/PlaylistManage";
import Playlists from "./pages/Playlists";
import PlaylistSpinner from "./pages/PlaylistSpinner";
import Settings from "./pages/Settings";
import Songs from "./pages/Songs";
import Spinner from "./pages/Spinner";
import TagEditor from "./pages/TagEditor";
import Tags from "./pages/Tags";
import Usdb from "./pages/Usdb";
import User from "./pages/User";
import UserAccounts from "./pages/UserAccounts";
import { useWingmanEvent } from "./hooks/useWingmanEvents";

// Split out: the two stats pages carry the chart drawing nothing else needs.
// echarts is gone — the charts are hand-drawn SVG now — so the chunk is small,
// but a visitor who never opens a scoreboard still skips it entirely.
const Scores = lazy(() => import("./pages/Scores"));
const UserStats = lazy(() => import("./pages/UserStats"));

/**
 * Every page somebody opens starts at the top of itself.
 *
 * The browser keeps the window's scroll offset across a `pushState`
 * navigation and React Router resets nothing, so a row at the foot of a long
 * page — the *Manage* menu under the user page's own record — opened the next
 * page already scrolled that far down. Nothing in the app did this before; the
 * one `window.scrollTo` there was belongs to the USDB page's paging.
 *
 * **PUSH only.** POP is the way back into a list somebody had scrolled — the
 * songs, the scores, a playlist — where the offset is exactly what they want
 * kept, and the browser restores it itself. REPLACE is one page standing in for
 * another (the editors swap `/new` for the id they just saved), where a jump to
 * the top would throw away the place the reader was working in.
 *
 * A layout effect, so the new page is painted at the top rather than painted
 * where the old one stood and moved a frame later.
 */
function ScrollToTop() {
  const { pathname } = useLocation();
  const navigation = useNavigationType();

  useLayoutEffect(() => {
    if (navigation !== "PUSH") return;
    window.scrollTo({ top: 0 });
  }, [pathname, navigation]);

  return null;
}

/**
 * A group was made, renamed, given other rights or deleted, or somebody was
 * put in one or taken out (permission-groups.md §4). What this browser may do
 * may have moved with it, so `/auth/me` is read again — a helper put in
 * Trusted sees the download button appear without a reload — and so are the
 * two listings that draw groups and memberships. Once for the whole app, not
 * per page: the event carries nothing, and every open page needs the same
 * three answers.
 */
function useGroupsChanged(): void {
  const queryClient = useQueryClient();
  useWingmanEvent("groups.changed", () => {
    for (const queryKey of [
      getMeQueryKey(),
      listGroupsQueryKey(),
      listUsersQueryKey(),
    ])
      void queryClient.invalidateQueries({ queryKey });
  });
}

export default function App() {
  useGroupsChanged();
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
      <ScrollToTop />
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/spinner" element={<Spinner />} />
          <Route path="/songs" element={<Songs />} />
          <Route path="/songs/playlists" element={<Playlists />} />
          <Route path="/songs/playlists/:playlistId" element={<Playlist />} />
          <Route
            path="/songs/playlists/:playlistId/manage"
            element={<PlaylistManage />}
          />
          <Route
            path="/songs/playlists/:playlistId/spinner"
            element={<PlaylistSpinner />}
          />
          <Route path="/usdb" element={<Usdb />} />
          <Route path="/scores" element={<Scores />} />
          <Route path="/user" element={<User />} />
          <Route path="/user/accounts" element={<UserAccounts />} />
          <Route path="/user/stats" element={<UserStats />} />
          <Route path="/user/groups" element={<Groups />} />
          {/* Before the id route, so `new` is a new group and not an id. */}
          <Route path="/user/groups/new" element={<GroupEditor />} />
          <Route path="/user/groups/:groupId" element={<GroupEditor />} />
          {/* The page's old address, so a bookmark still lands. */}
          <Route
            path="/user/permissions"
            element={<Navigate to="/user/groups" replace />}
          />
          <Route path="/user/achievements" element={<Achievements />} />
          <Route
            path="/user/achievements/new"
            element={<AchievementEditor />}
          />
          <Route
            path="/user/achievements/:achievementId"
            element={<AchievementEditor />}
          />
          <Route path="/user/devices" element={<Devices />} />
          {/* Before the id route, so `new` is the wizard and not a device. */}
          <Route path="/user/devices/new" element={<DeviceSetup />} />
          <Route path="/user/devices/:deviceId" element={<Device />} />
          <Route path="/user/tags" element={<Tags />} />
          <Route path="/user/tags/new" element={<TagEditor />} />
          <Route path="/user/tags/:tagId" element={<TagEditor />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/host" element={<Host />} />
          <Route path="/host/manage" element={<HostManage />} />
        </Routes>
      </Suspense>
      {/* The screen that makes the background music, at the app root rather than
          on the host page: `/host/manage` is a sibling route and the host walks
          from it into the settings and the admin pages, and a sink under any one
          page would unmount and stop the music mid-song. It draws nothing, and
          it plays nothing unless this browser is the host screen. */}
      <MusicSink />
      {!onHost && <BottomNav />}
    </>
  );
}
