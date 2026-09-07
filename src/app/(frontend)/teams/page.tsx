import { permanentRedirect } from 'next/navigation'

/**
 * `/teams` became `/people` when the collection stopped meaning "a group" and started
 * meaning "a person". Bookmarks, pasted links and anything an agent stored still point
 * here, so this stays as a permanent redirect rather than a 404.
 */
export default function TeamsRedirectPage() {
  permanentRedirect('/people')
}
