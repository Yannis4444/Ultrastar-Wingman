import { Route, Routes } from "react-router-dom";
import BottomNav from "./components/BottomNav";
import Home from "./pages/Home";
import Scores from "./pages/Scores";
import Songs from "./pages/Songs";
import User from "./pages/User";

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/songs" element={<Songs />} />
        <Route path="/scores" element={<Scores />} />
        <Route path="/user" element={<User />} />
      </Routes>
      <BottomNav />
    </>
  );
}
