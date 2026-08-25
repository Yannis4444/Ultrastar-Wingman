import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { SONG_SOURCES } from "../songSources";
import "./AddSongsModal.css";
import { Icon } from "./icons";
import Modal from "./Modal";

interface AddSongsModalProps {
  onClose: () => void;
}

/** Picks where new songs come from. Every source is a card that leads to its
 *  own search view. */
export default function AddSongsModal({ onClose }: AddSongsModalProps) {
  const auth = useAuth();
  const sources = SONG_SOURCES.filter((source) => auth.can(source.capability));

  return (
    <Modal title="Add songs" onClose={onClose}>
      <p className="add-songs-intro">
        New songs come from an online database. Pick one to search it and
        download into the local library.
      </p>
      <div className="add-songs-grid">
        {sources.map((source) => (
          <Link
            key={source.id}
            to={source.route}
            className="add-songs-card"
            onClick={onClose}
          >
            <Icon name={source.icon} className="add-songs-card-icon" />
            <span className="add-songs-card-name">{source.name}</span>
            <span className="add-songs-card-text">{source.description}</span>
          </Link>
        ))}
      </div>
    </Modal>
  );
}
