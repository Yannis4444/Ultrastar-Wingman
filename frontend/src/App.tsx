import { Route, Routes, useLocation } from "react-router-dom";
import BottomNav from "./components/BottomNav";
import Home from "./pages/Home";
import Host from "./pages/Host";
import Scores from "./pages/Scores";
import Songs from "./pages/Songs";
import User from "./pages/User";

export default function App() {
  // The host screen is a TV view, not a phone: no tab bar on it.
  const onHost = useLocation().pathname === "/host";

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/songs" element={<Songs />} />
        <Route path="/scores" element={<Scores />} />
        <Route path="/user" element={<User />} />
        <Route path="/host" element={<Host />} />
      </Routes>
      {!onHost && <BottomNav />}
    </>
  );
}
