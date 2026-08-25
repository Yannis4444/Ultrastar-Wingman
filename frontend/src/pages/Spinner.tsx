import { useAuth } from "../auth";
import PageHeader from "../components/PageHeader";
import SongSpinner from "../components/SongSpinner";

export default function Spinner() {
  const auth = useAuth();

  return (
    <>
      <PageHeader title="Random song" back="/" />
      {/* Nothing until /auth/me answered: `can` says yes while it is in flight. */}
      {auth.loaded &&
        (auth.can("songs.view") ? (
          <SongSpinner />
        ) : (
          <p className="settings-notice">
            The song library is not open to your role. Log in or ask the host
            for access.
          </p>
        ))}
    </>
  );
}
