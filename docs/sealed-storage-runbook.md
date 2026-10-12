# Sealed storage runbook

How to run a Deck whose encrypted workspace files deny ordinary host-root reads. This
is the encryption-at-rest half of [Sealed Deck](sealed-deck-prd.md), decided
in ADR-0012. The chat half, the relay palace and sealed bodies, has its own
runbook once it lands; this document is complete on its own for a single
Deck.

## What this protects, in one paragraph

The other operator, running `sudo cat`, `sudo ls`, `podman inspect`, or
reading a backup or a replica, sees ciphertext or is denied. That is the
workspace-file claim; swap and other persisted memory images are excluded.
Personal swap can contain plaintext, and root can read an active encrypted swap
mapping too. Switching to the partner's user, entering the container, reading
process memory, changing the mount options, or shipping a modified Deck are
outside it. Some of those are one command. They are excluded because the
operator chose this bound, not because they are hard, and the partner should
read this paragraph before calling anything sealed.

## The two profiles

**Shared host** is the chosen profile: the partner's Deck runs on a machine
the other operator administers. The partner's state root is a gocryptfs
directory mounted by a dedicated Unix user that only the partner can log in
as, without `allow_other` or `allow_root`, on a kernel whose
`allow_sys_admin_access` FUSE parameter is off. The passphrase is typed by
the partner and never deliberately stored on the host. Swap uses the separate
[personal/paranoid policy](security/workspace-swap.md); the default is personal. The
container runs as that user. The other operator's whole-disk LUKS does not
count, because the other operator unlocks it.

**Own host** is the stronger alternative: the partner owns the machine or
the cloud account and the other operator holds no login, console, snapshot,
recovery or update credential. The state root is whole-disk LUKS. The same personal/paranoid swap policy applies. A tmpfs `/tmp` is allowed.

Both profiles are checked by the same preflight, and Deck refuses to serve
on either until the check passes.

## The state root

One directory holds every store Deck writes to. The layout is fixed, because
the preflight and the compose overlay both name it:

```
<state root>/
  data/       the control database                  -> /data
  home/       provider homes, transcripts, palace    -> /home/agent
  projects/   the work                               -> /workspace
  tmp/        temporary files                        -> /tmp
  gh/         GitHub CLI config                      -> /home/agent/.config/gh
```

The two Docker named volumes the base compose file uses do not exist under
this overlay. Docker's own volume directory is under `/var/lib/docker`,
which no state root covers, so the overlay resets the named volumes and
binds these directories instead. `/tmp` leaves RAM for the same reason: root
on the host reads a container's tmpfs through `/proc/<pid>/root/tmp` without
entering the container, so temporary files need the same denial as
everything else on the shared-host profile.

## Shared-host profile, step by step

Everything below runs as the partner's user unless it says otherwise. The
other operator does the two root steps and is then done.

1. **Root, once: create the partner's user and install gocryptfs and
   Podman.** The user needs a login only the partner holds and a range of
   subordinate ids, which `useradd` allocates on modern distributions. The
   partner's Deck runs under rootless Podman as that user, with no docker
   group and no root daemon involved. A root daemon cannot launch this
   layout at all: the state root denies root, so Docker's daemon cannot
   even stat the bind sources inside it. Rootless Docker cannot either,
   because it maps container uids to subordinate host uids that cannot
   open the mount. Rootless Podman with a keep-id namespace makes the
   container's runtime uid the partner's own host uid, which is exactly the
   identity the mount admits.

   ```sh
   sudo useradd -m -s /bin/bash partner
   sudo passwd partner                          # the partner types this, not you
   sudo apt-get install gocryptfs podman podman-compose  # or the distribution's packages
   grep partner /etc/subuid /etc/subgid         # a range on each line; add one if absent
   sudo loginctl enable-linger partner          # the user's services survive logout
   ```

   Check the FUSE parameter and swap while root:

   ```sh
   cat /sys/module/fuse/parameters/allow_sys_admin_access   # must print N
   cat /proc/swaps                                          # inventory active swap
   cat /sys/power/resume                                    # must print 0:0
   ```

   Keep swap available. Personal mode accepts ordinary swap. For paranoid mode,
   provision and verify a dedicated dm-crypt swap mapping using the
   [swap guide](security/workspace-swap.md). Do not disable all host swap as an
   encryption prerequisite. Neither mode prevents root reading persisted memory
   through an active mapping.

2. **Partner: create the encrypted directory.** The cipher directory can sit
   anywhere the partner's user can write; the plaintext view is a mount
   point the partner owns.

   ```sh
   mkdir -p ~/deck.cipher ~/deck
   gocryptfs -init ~/deck.cipher     # choose the passphrase; never write it down on this host
   ```

   Keep the master key gocryptfs prints somewhere off this host. It is the
   only recovery path if the passphrase is lost.

3. **Partner: mount, and lay out the root.** Mount without `allow_other`,
   which is the default. That default is the mechanism: FUSE denies every
   uid but the mounter, root included.

   ```sh
   gocryptfs ~/deck.cipher ~/deck
   mkdir -p ~/deck/data ~/deck/home ~/deck/projects ~/deck/tmp ~/deck/gh
   ```

   Prove the denial before going further, on a file, not a directory: a
   directory that is readable still makes `cat` fail, so a directory proves
   nothing. As the partner:

   ```sh
   echo "proof $(date -u +%s)" > ~/deck/data/proof.txt
   cat ~/deck/data/proof.txt                 # prints the line
   ```

   From another terminal as the other operator:

   ```sh
   sudo cat /home/partner/deck/data/proof.txt
   # want exactly: cat: /home/partner/deck/data/proof.txt: Permission denied
   sudo ls /home/partner/deck.cipher         # names are ciphertext
   ```

   The only acceptable outcome is `Permission denied`. The line printing
   means the mount has `allow_other` or `allow_root`, or
   `allow_sys_admin_access` is on. `No such file or directory` means the
   probe file was never written or the paths differ, and proves nothing.

4. **Partner: the env file.** Start from `deploy/compose.env.example` and
   set, in addition to the ordinary values:

   ```sh
   COMPOSE_PROJECT_NAME=partner-deck
   NOISEDECK_SEALED_HOSTNAME=partner-deck        # the chat identity peers pin; fixed, so a down and up keeps the pins
   NOISEDECK_SEALED_PROFILE=shared-host
   NOISEDECK_SWAP_POLICY=personal             # paranoid opts into verified encrypted swap
   NOISEDECK_SEALED_STATE_ROOT=/home/partner/deck
   NOISEDECK_SEALED_REPORT_DIR=/run/user/1001/noisedeck-sealed
   NOISEDECK_MEMPALACE_HOST_PATH=/home/partner/deck/home/.mempalace
   NOISEDECK_PROJECTS_HOST_PATH=/home/partner/deck/projects
   NOISEDECK_AUTH_MODE=password
   ```

   The file is dotenv, not shell: nothing in it is evaluated, so write the
   numbers out. `1001` above is the partner's uid from `id -u`; replace it
   with the real one. `NOISEDECK_RUNTIME_UID` and `NOISEDECK_RUNTIME_GID`
   keep the image's defaults (1026 and 100): they are uids inside the
   container's namespace, and Podman's keep-id mapping makes the partner's
   host uid appear as that runtime uid inside, whatever the two numbers
   are. Interpolation between keys works as Compose does it
   (`ROOT=/home/partner/deck` then `NOISEDECK_SEALED_STATE_ROOT=${ROOT}`);
   command substitution does not, and the wrapper refuses a file that
   tries.

   `COMPOSE_PROJECT_NAME` is not optional. The base compose file names its
   project `deck`, which is the operator's own Deck; the wrapper refuses
   that name and any empty one, and passes the partner's name to every
   compose call, so `down` and `up` can only ever address the partner's
   containers. The report directory must be RAM-backed; `/run/user/<uid>`
   is a tmpfs systemd creates at login, and the wrapper refuses anything
   that is not tmpfs. `NOISEDECK_MEMPALACE_HOST_PATH` and `NOISEDECK_PROJECTS_HOST_PATH`
   are required by the base files even though the sealed overlay replaces
   their mounts; pointing them under the root keeps them honest.

5. **Partner: bring Deck up through the wrapper, never through `docker
   compose` directly.**

   ```sh
   deploy/sealed-compose.sh compose.env up
   ```

   The wrapper refuses to run as root, refuses unless `podman info` says it
   is rootless for this user, qualifies the host (every store under the
   root resolves to the gocryptfs mount owned by this uid, the selected swap policy passes, no
   hibernation), starts the container through `podman compose` with the
   sealed overlay, reads the container's own mount table, writes the
   launch-bound report into the tmpfs, and asks the container to run
   `noise deck sealed-check`. Bootstrap inside the container starts nothing
   that writes until that report is present and matches, so a wrapper that
   dies halfway leaves an idle container and no plaintext.

   `deploy/sealed-compose.sh compose.env check` runs only the host
   qualification. `report` rewrites the report for a running container, for
   example after a wrapper crash.

6. **Prove the claim on the running system.** Write one harmless file into
   each store from inside the container, as the partner, and read it back
   to show the runtime can:

   ```sh
   for d in /data /home/agent /workspace /tmp /home/agent/.config/gh; do
     podman compose --project-name partner-deck exec -T app sh -c "echo proof > $d/sealed-proof.txt && cat $d/sealed-proof.txt"
   done
   ```

   Then, as the other operator, read each one directly and through the
   process alias. Every line must end in `Permission denied`; a line that
   prints `proof` is a broken boundary, and `No such file or directory`
   means the probe did not run and proves nothing:

   ```sh
   pid=$(sudo -u partner podman inspect -f '{{.State.Pid}}' partner-deck_app_1)
   for f in data/sealed-proof.txt home/sealed-proof.txt projects/sealed-proof.txt tmp/sealed-proof.txt gh/sealed-proof.txt; do
     sudo cat "/home/partner/deck/$f"
   done
   for f in /data /home/agent /workspace /tmp /home/agent/.config/gh; do
     sudo cat "/proc/$pid/root$f/sealed-proof.txt"
   done
   sudo ls /home/partner/deck.cipher/                          # ciphertext names
   sudo -u partner podman inspect partner-deck_app_1 | grep -i password   # the hash and session secret
   ```

   The last line is the exposure the profile does not hide: configured
   secrets Deck reads from the environment are visible to anyone who can
   inspect the container, root included through the partner's account. They are the partner's to rotate and are not private
   data; the onboarding document says so. Never probe with a real
   credential file: a broken boundary would print it.

7. **Backups.** Take them with a recipient, so the file that leaves the host
   is ciphertext, and keep the identity off the host:

   ```sh
   age-keygen -o ~/deck-backup-identity.txt      # keep this off the host
   podman compose --project-name partner-deck exec app noise deck backup -recipient age1... -dest /data/backups/control-$(date -u +%Y%m%dT%H%M%SZ).db.age
   ```

   The provider homes and the palace are backed up by copying
   `~/deck.cipher`, which is ciphertext at rest and needs the passphrase or
   the master key to open.

8. **Locking.** `deploy/sealed-compose.sh compose.env down`, then
   `fusermount -u ~/deck`. With the mount gone, every byte under
   `~/deck.cipher` is ciphertext to everyone, root included. On the next
   login the partner mounts again and runs `up`; there is no unattended
   unlock in v1, and a key stored on the same disk is not permitted.

## Own-host profile

The partner controls the whole machine, so the layout is simpler: whole-disk
LUKS, unlocked at boot by the partner, covers Docker's volume directory and
everything else. The overlay and wrapper are the same; the profile changes
what the preflight accepts, and `docker compose` is fine here because root
is the partner. Set `NOISEDECK_COMPOSE_COMMAND` to choose the front end
explicitly on either profile.

```sh
NOISEDECK_SEALED_PROFILE=own-host
NOISEDECK_SEALED_HOSTNAME=my-deck          # the chat identity peers pin
NOISEDECK_SEALED_STATE_ROOT=/srv/deck      # any directory on the LUKS root
NOISEDECK_SEALED_REPORT_DIR=/dev/shm/deck-sealed
```

On this profile the container runs as the image's runtime uid, not yours,
so the report directory lives on a tmpfs every uid can traverse; the
wrapper makes it world-readable, refuses a path whose parents are not
traversable, and the report holds only mount facts.

The preflight resolves each store to its block device, through the btrfs
device list when the filesystem is btrfs, and accepts only a device-mapper
target whose uuid begins with `CRYPT-`. Personal mode permits ordinary swap; paranoid mode requires verified
encrypted swap. Hibernation must still be off. A tmpfs `/tmp` passes on this
profile, since the disk never sees it and root is the partner.

## What the preflight checks, and what a refusal means

| Refusal | Cause | Fix |
|---|---|---|
| `<store>: plaintext, ext4 on /dev/... is not encrypted` | the store's host path is on an unencrypted filesystem | move the store under the encrypted root |
| `<store>: plaintext, gocryptfs mounted with allow_other` | the mount lets other users, root included, read the view | remount without `allow_other` |
| `<store>: plaintext, gocryptfs mounted by uid N, not the partner uid M` | the mount belongs to a user other than the one running the wrapper | run the wrapper as the user who mounted the root, or remount as the user who will run it |
| `kernel fuse.allow_sys_admin_access is on` | the kernel lets root through every FUSE mount | `echo N | sudo tee /sys/module/fuse/parameters/allow_sys_admin_access`, and make it persistent |
| `swap ... is not verified dm-crypt` | paranoid mode cannot prove an active entry encrypted | use a supported dm-crypt mapping and verify host/container visibility; keep swap available |
| `paranoid swap policy requires active encrypted swap` | no active swap | provision and activate verified encrypted swap |
| `host report swap policy does not match installation` | stale report or inconsistent configuration | align the installed policy and regenerate the report through the wrapper |
| `hibernation resume device is set` | the kernel would write memory to disk | clear `resume=` from the kernel command line |
| `<store>: unresolved, btrfs source ... has no readable device list` | the host cannot map btrfs to its devices | run the preflight on the host, not in a container; check `/sys/fs/btrfs` |
| `<store>: container mount is X root Y, qualified host source is ...` | the container's mount does not come from the qualified path | check the env file's `NOISEDECK_SEALED_STATE_ROOT` and the overlay |

Inside the container, `noise deck sealed-check` prints one line per store.
A store marked `unresolved` with `host report is from another boot` or
`for another container` means the report is stale: run
`deploy/sealed-compose.sh compose.env report`.

## What this does not cover

Live process memory and tmux scrollback while the mount is open. The mount
options being changed by root. A modified Deck binary. A partner who pastes
a secret into a chat. The partner's provider accounts and what those
providers keep.
