import { Suspense, lazy } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import BottomNav from "./components/BottomNav";
import Spinner from "./components/Spinner";
import Home from "./pages/Home";
import Host from "./pages/Host";
import Settings from "./pages/Settings";
import Songs from "./pages/Songs";
import Usdb from "./pages/Usdb";
import User from "./pages/User";
import UserAccounts from "./pages/UserAccounts";
import UserPermissions from "./pages/UserPermissions";

// Split out on its own: the stats page is the only echarts user, and echarts is
// larger than the rest of the app put together. Every other page stays eager —
// they share the same handful of components anyway.
const Scores = lazy(() => import("./pages/Scores"));

export default function App() {
  // The host screen is a TV view, not a phone: no tab bar on it.
  const onHost = useLocation().pathname === "/host";

  return (
    <>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/songs" element={<Songs />} />
          <Route path="/usdb" element={<Usdb />} />
          <Route path="/scores" element={<Scores />} />
          <Route path="/user" element={<User />} />
          <Route path="/user/accounts" element={<UserAccounts />} />
          <Route path="/user/permissions" element={<UserPermissions />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/host" element={<Host />} />
        </Routes>
      </Suspense>
      {!onHost && <BottomNav />}
    </>
  );
}
