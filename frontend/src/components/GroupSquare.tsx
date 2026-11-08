import { ADMIN } from "../groups";
import { Icon } from "./icons";
import "./GroupSquare.css";

/**
 * The 40px square a group leads its row with (ui-guidelines §3, §4): `shield`
 * for Admin, the rights behind the host, and `users` for every other group, a
 * bundle of accounts. Decoration: the row's own text names the group.
 */
export default function GroupSquare({ groupId }: { groupId: string }) {
  return (
    <span className="group-square" aria-hidden="true">
      <Icon name={groupId === ADMIN ? "shield" : "users"} />
    </span>
  );
}
