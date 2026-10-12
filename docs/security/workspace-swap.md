# Workspace swap policy

Keep swap available in both personal and paranoid deployments. Deck validates
the chosen policy; it never formats a device, runs `swapoff`, or reconfigures
the host. Workspace file encryption is independent of swap encryption.

| Policy | Enforcement | Privacy limit |
| --- | --- | --- |
| `personal` (default) | Ordinary swap is accepted on either filesystem layout. | Plaintext workspace data and keys can reach swap outside the encrypted workspace. Locking Deck does not erase those pages. |
| `paranoid` (opt-in) | At least one active swap device is required. Every active entry must be independently identifiable as a direct dm-crypt block mapping by the native observer, host preflight and container check. Unknown, mixed plaintext/encrypted, swap-file or unobservable backing refuses admission. | Protects offline swap backing, not plaintext available to the running host administrator through the decrypted mapping. |

The current supported encrypted backing is a direct dm-crypt swap block device,
either LUKS or a plain mapping with a fresh random boot key. A file-backed loop
device underneath that direct mapping also qualifies; a regular swap file on an
encrypted filesystem does not provide the same container-visible proof. Its kernel entry and
dm UUID must be visible through `/proc/swaps` and sysfs to the host and container.
Do not expose a block device or its keys inside the workload merely to satisfy
the check. Swap files, LVM layers above dm-crypt, zram and zswap alone do not
establish this paranoid-mode proof. Unsupported layouts refuse rather than
being assumed encrypted. Personal mode accepts those layouts.

The policy is not an assertion that all memory is protected. Hibernation remains
refused by the sealed-storage checks. Disable crash dumps or separately protect
and qualify their destinations. Include physical-host swap, sleep images,
crash dumps and memory-bearing VM snapshots when Deck runs inside a VM. A guest
cannot certify its host from guest kernel observations. Memory inspection and a
host administrator actively changing software or extracting keys remain outside
the claim. Previously written plaintext swap and backups are not retroactively
protected by changing this setting.

## Configure Deck

For the browser-managed gateway, choose before opening its control/native journals:

```json
{
  "native": {
    "SwapPolicy": "personal"
  }
}
```

This is a fragment of the normal gateway configuration. `paranoid` opts into
encrypted-swap verification. Omission means `personal`. The controller passes
the pinned choice to the sealed wrapper, overriding an ambient or dotenv
`NOISEDECK_SWAP_POLICY`. A browser cannot alter host policy.

For a manually managed sealed deployment, set the same choice in its Compose
dotenv file:

```dotenv
NOISEDECK_SWAP_POLICY=personal
```

The application setting is `sealed.swap_policy`; the environment variable
overrides it. The wrapper's launch report includes the selected policy. A report
from a different policy cannot authorize startup. Older reports without this
field mean personal; paranoid deployments need a fresh report. Unrecognized
policy names refuse configuration or admission.

Existing gateway configurations which omit `SwapPolicy` retain their serialized
configuration fingerprint and now use personal policy. This intentionally
replaces the old no-swap behavior. Announce the changed swap privacy limit before
upgrading an existing shared-host installation. Setting or changing an explicit
policy changes the pinned installation configuration and is refused by an
existing native journal; do not edit/delete the journal to bypass that refusal.
Choose paranoid for a fresh installation, or use the existing verified migration
procedure into a separately configured installation. These changes do not
reconfigure an already deployed host or replace an older pinned canary binary.

## Personal deployment

Keep the host's ordinary swap configuration and provision enough capacity for
the workload. Inventory it with `swapon --show`; Deck does not require encrypted
swap in this mode and does not turn existing encryption off. Follow the normal
encrypted-workspace setup if workspace encryption is wanted. Explain that the
encrypted-volume promise excludes plaintext spilled into swap.

## Paranoid deployment

The host administrator provisions swap before owner enrollment. Use a dedicated,
disposable swap partition or logical block device with no data to preserve.
Never apply a swap-formatting recipe to a workspace, root or backup device.

One Linux/systemd option is a plain dm-crypt mapping with a fresh random key on
each boot. An illustrative `/etc/crypttab` entry is:

```text
deck-swap /dev/disk/by-id/DEDICATED_SWAP_DEVICE /dev/urandom plain,swap,cipher=aes-xts-plain64,size=512
```

The corresponding `/etc/fstab` entry is:

```text
/dev/mapper/deck-swap none swap defaults 0 0
```

Substitute the actual dedicated device and activate it using the distribution's
cryptsetup/systemd procedure. The `swap` option formats that mapped device as
swap. A random boot key prevents resuming an earlier hibernation image, which
Deck does not permit anyway. Consult the distribution's
[crypttab documentation](https://www.freedesktop.org/software/systemd/man/latest/crypttab.html).
Do not store an unprotected persistent swap key next to the ciphertext.

Verify the new mapping is active before retiring any old plaintext swap. Check
available memory and change individual old entries deliberately; do not run
`swapoff -a`. Remove stale boot activation entries so plaintext swap does not
return after reboot. The host should retain usable swap throughout the change.
If a mapping is encrypted but Deck cannot verify it from both namespaces,
correct its visibility/layout or use personal mode explicitly; do not fake a
report or label the unverified setup paranoid.

Run the normal sealed wrapper checks, including container admission, and repeat
after reboot. The host-only preflight can be inspected with:

```sh
python3 deploy/sealed-preflight.py qualify --env-file /absolute/instance.env --swap-policy paranoid
```

This does not override the gateway's pinned policy or prove container admission.
Use the same policy throughout. An unencrypted swap entry enabled later makes
the next paranoid observation/check refuse; Deck does not kill running sessions
or retroactively erase already swapped pages. Continuous host configuration
management remains the administrator's responsibility.

## Qualification

On a disposable host, demonstrate personal admission with ordinary swap and
paranoid admission with the direct encrypted mapping. In paranoid mode, add a
second plaintext swap entry, remove sysfs visibility, change the report policy,
and remove all swap: each must refuse initialization/startup without native
mutation. Verify existing encrypted workspace data remains intact after refusal.
Use synthetic secrets, separate test storage and real mount/container evidence.
Unit fixtures prove policy decisions, not physical-host or VM-host protection.
